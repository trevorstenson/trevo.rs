---
title: "Proxies and ChatGPT"
date: "2023-01-15"
tags: ["javascript"]
description: "Messing with runtime LLM function generation"
---

For the past few months, ChatGPT has taken the software community by storm.
People have experimented with using it to do things like simulate running a [virtual linux machine](https://www.engraved.blog/building-a-virtual-machine-inside/)
with graphics card and network access, and even replace Redux with a [universal reducer](https://spindas.dreamwidth.org/4207.html) interface.

While there are certainly glaring issues with relying on these models, they are still remarkably fun to play with. Outside of direct API access, I wanted to see if there was a clever way to interface with these models in a more declarative manner.

## Declarative GPT-3 Proxies

Say what you will, JavaScript is one of my favorite languages to mess around in due to its flexibility. One of my favorite features of the language is the [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) object. With a Proxy, you are able to easily wrap a given object with a new object that has the optional ability to redefine operations and properties of the original.

They are used to:

- Overwrite existing functionality (ex: monkey patching)
- Enhance existing functionality (ex: wrap existing functions with extra logging, validating/sanitizing input)
- Define completely new functionality

While the most common use case for Proxies involve overwriting existing functionality, I am primarily interested in the final use case. What if we could use this idea of runtime-defined functionality to interface with GPT-3 as our source of truth?

## Implementation

The goal here is to see if I can leverage proxies to create a fully declarative approach to interacting with GPT-3, where the user can simply invoke a method without an existing definition and get back a return value from the model. To do this, we will need to:

1. Intercept and define functionality fully at runtime for non-existent methods on an object
2. Infer some basic meaning from the methods signature and arguments
3. Use GPT-3 or another LLM to synthesize an appropriate return value for the method

First things first, we need to find an easy way to handle calling non-existing methods on an object. If we were to do this with a standard object, we would immediately get an error. In order to fix this, let's create a Proxy and use something known as the get 'trap' to prevent any errors from being thrown.

The `get()` handler is called whenever an object property is accessed, and provides the target object, property name, and the proxy object itself as arguments. BEcause whatever we return here will be treated as the value of the property, we can use this to return a value received whenever any property is accessed:

```js
const empty_obj = {};

empty_obj.foo(); // TypeError: obj.foo is not a function

const proxy_handler = {
  get: (target, prop, receiver) => {
    return () => {
      console.log("unknown method successfully called!");
    };
  },
};
const obj_proxy = new Proxy(empty_obj, proxy_handler);

obj_proxy.foo(); // "unknown method successfully called!"
```

Now whenever we access a non-existent property, we get back a function that prints a message.

## Inferring Meaning

To take this further we need to think about how to convert arbitrary method calls into meaningful input for GPT-3. I wanted to make this interface as declarative as possible while requiring a minimal amount of boilerplate.

Instead of making the user write their prompt as an argument to the method, why don't we just use the method name and arguments to build a prompt? Since we have access to the property name within the get() trap, this is a trivial process. We just need to convert the property name from camelCase to a sentence.

To handle arguments as potential input to the prompt, we can use the `arguments` object.

```js
const proxy_handler = {
  get: (target, prop, receiver) => {
    return () => {
      const parse_prop = prop.match(/[A-Z][a-z]+/g);
      let prompt = parse_prop.join(" ");
      const arg_list = Object.values(arguments);
      const arg_str = arg_list
        .map((x) => JSON.stringify(x) || x.toString())
        .join(", ");
      console.log(`Prompt: ${prompt}`);
      console.log(`Arguments: ${arg_str}`);
    };
  },
};
obj_proxy.WhatColorIsTheSky();
// "Prompt: What Color Is The Sky"
obj_proxy.WhatIsThisTimesTwo(23);
// "Prompt: What Is This Times Two"
// "Arguments: 23"
obj_proxy.WhatIsTheSetDifference([1, 2, 3], [2, 3, 4]);
// "Prompt: What Is The Set Difference"
// "Arguments: [1, 2, 3], [2, 3, 4]"
```

## Prompt Engineering?

The only thing left is to figure out the best way to pipe this data into GPT-3. With this system, someone can write arbitrary functions to be interpreted by GPT-3. This makes supporting all types of statements a tedious affair. Some operations are clearly simple requests for information, while others may be more complex questions that need to provide arguments in a very structured manner.

In the following simple implementation, method arguments are appended to the end of the prompt following a colon. This is a very naive approach, and will not work for all cases.

Handling return values was also a bit tedious. The goal of our proxy is to provide the GPT-3 output as a method return value. In context of the question asked, different types of output may be expected. While it's impossible to always know what the user expects, the easiest thing to do would be ensure the response value is always just the answer with no additional context:

```js
if (arg_str) {
  prompt = `
    Return back only the answer and nothing else:\n
    ${prompt}: ${arg_str}
  `;
}
```

These models will sometimes provide answers as part of a sentence, so asking for only the answer is a good way to prevent cases where the answer is not the only thing returned:

```js
/* Generated prompt:
 * Return back only the answer and nothing else:
 * What Is This Times Two: 23
 */
let answer = await obj_proxy.WhatIsThisTimesTwo(23);
console.log(answer); // 46

/* Generated prompt:
 * Return back only the answer and nothing else:
 * Apply The Following Function To The Following Array: (x) => x * 4, [1,2,3,4,5]
 */
let answer = await obj_proxy.ApplyTheFollowingFunctionToTheFollowingArray(
  (x) => x * 4,
  [1, 2, 3, 4, 5]
);
console.log(answer); // [4, 8, 12, 16, 20]

// Generated prompt: "What Is The Capital Of Canada"
let answer = await obj_proxy.WhatIsTheCapitalOfCanada();
console.log(answer); // Ottawa is the capital of Canada.

// create a reusable getter function
const square_getter = gen.WhatIsTheSquareRoot;
await square_getter(25); // 5
await square_getter(36); // 6
```

Here is the full implementation for this proof-of-concept:

```js
import { openai_request } from "./chatgpt.js";

const proxy_handler = {
  get: function (target, prop, receiver) {
    const parse_prop = prop.match(/[A-Z][a-z]+/g);
    return async function () {
      const arg_list = Object.values(arguments);
      const arg_str = arg_list
        .map((x) => JSON.stringify(x) || x.toString())
        .join(", ");
      return new Promise((res) => {
        let connected_prompt = parse_prop.join(" ");
        if (arg_str) {
          connected_prompt = `
          Return back only the answer and nothing else:\n${connected_prompt}: ${arg_str}
          `;
        }
        openai_request(connected_prompt).then((data) => {
          res(data);
        });
      });
    };
  },
};

const gen = new Proxy({}, proxy_handler);
```

While I didn't want to spend too much time supporting more complex cases for this proof-of-concept, an obvious improvement would be supporting some form of prompt templating/interpolation to place arguments in places that make more sense. Currently this simply appends the arguments at the end of the prompt. Something like using `$` in the function name to mark where the arguments should be placed would be a good start to improve interpretation and quality of results:

```js
obj_proxy.WhatIs$MultipliedBy$(23, 5);
// "Prompt: What Is 23 Multiplied By 5"
```

The argument representaion/serialization could also be improved. Currently these are naively stringified using `JSON.stringify()` and `.toString()` to handle functions. A more reliable serialization method combined with possibly providing type information to GPT-3 would be a good next step.

## Conclusion

This serves as a surprisingly nice to use interface for GPT-3 where a user can write arbitrary prompts with dynamic input in the form of invokable method calls and parameters. While I highly doubt this will ever be useful, I think seeing new methods for how we as developers may interface with LLMs as time goes on is fascinating.
