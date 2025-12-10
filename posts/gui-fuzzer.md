---
title: "Experiments in Fuzzing React GUIs"
date: "2024-05-31"
tags: ["javascript", "react"]
description: "Coverage-guided fuzz testing and state visualization of React components"
---

Fuzzing is an area of software that has interested me for a while. The idea of being able to quickly test a broad variety of program input given a set of constraints, and be given back a set of both trivial and more complex issues is compelling. Web applications and web frontends in general seem to be a relatively unexplored surface for applying fuzzing techniques toward, so I decided to try my hand at implementing some version of a fuzzer for web frontends. What if we were able to graphically represent all possible states of a React component, and visualize the interactions required to reach each state in a way that is both useful and intuitive, without having to rely on any sort of manual testing?

## Web GUIs as a fuzzing surface

The most common type of programs that utilize fuzz testing are:

1. Compiled binaries that take in raw data as input (strings, buffers, files, etc)
2. Isolated functions with specific data types as input that the fuzzing engine knows how to manipulate

In both instances, the fuzzer can strategically manipulate inputs using both simple and complex strategies, and definitively compare outputs between executions. However, when considering this approach for testing web applications, we must account for significant differences. Web applications do not fit the same mold as the cases mentioned above:

- There is often no single "entry point" to the program, nor a defined end state.
- There is no defined "output" to compare between "executions"
- The types of inputs are more varied and complex than something like strings or buffers

To develop a sensible fuzzing strategy for frontend components, I defined the following behaviors as the primary fuzzing goals:

1. Provide an isolated React component as the fuzz target.
2. Enumerate all possible "states" of a given component.
3. Track all interactions/inputs required to reach these states.
4. Display a visualization that traces all states/interactions in order to provide a visual representation of the component's behavior.

## Component Instrumentation and State Enumeration

The obvious challenge with this approach is tracking all possible states. What constitutes a different state of a component?

Naively, the simplest approach would be comparing the final rendered HTML of a component after each input. This is not a good approach for one major reason: very minor changes in the component's rendered DOM would register as a new state. Problematic examples include:

1.  Different counts of entries in an `<li>` element that the user may see as the same state, but the code would not.
2.  Functions that aren't determined solely by component input (e.g. `Date.now()` or a random number generator) would cause the component to render differently each time, even if the input is the same.

Ultimately, you'd end up with a huge number of states that are possibly the same from a user's perspective.

A more generalizable and reliable approach would be to use instrumentation to effectively track code execution paths. Each time a component renders, React's JSX expressions execute to build a DOM, and any other code placed in the component's function body would be executed. By instrumenting the component's code and observing what code paths are taken, we can represent each unique code path and its resulting visual representation as a state within our fuzzer.

To do this, I used `babel` to transform the supplied component's code to include instrumentation in the following code areas:

1. Block statements (if, else, for, while, logical blocks, etc)
2. JSX expression containers. A common approach to JSX rendering is using ternary/logical operators to conditionally render depending on another value. This would be considered a separate code path, as it changes the final DOM output.

For each of these areas, I added a method call to a global instance of my `Fuzzer` class. This method would take in a unique identifier (integer) for identifying the logical block of code that was executed.

In the following example, the `buttonTravelComponent` component would be transformed to include instrumentation:

Source:

```jsx
function buttonTravelComponent() {
  const [step, setStep] = React.useState("a");

  return (
    <div className="h-full w-full bg-white p04">
      {
        step === "a" && (
          <>
            <h1 className="text-black">Step A</h1>
            <button data-fuzz-id="1" onClick={() => setStep("b")} className="bg-blue-500 text-white px-4 py-2 mt-2">to B</button>
          </>
        )
      }
      {
        step === "b" && (
          <>
            <h1 className="text-black">Step B</h1>
            <button data-fuzz-id="2" onClick={() => setStep("a")} className="bg-blue-500 text-white px-4 py-2 mt-2">to A</button>
            <button data-fuzz-id="3" onClick={() => setStep("c")} className="bg-blue-500 text-white px-4 py-2 mt-2">to C</button>
          </>
        )
      }
      {
        step === "c" && (
          <>
            <h1 className="text-black">Step C</h1>
            <button data-fuzz-id="4" onClick={() => setStep("b")} className="bg-blue-500 text-white px-4 py-2 mt-2">to B!!! from C</button>
          </>
        )
      }
    </div>
  );
}
```

Transformed:

```jsx
function buttonTravelComponent() {
  window.Fuzzer?.hit(0);
  const [step, setStep] = React.useState("a");

  return (
    <div className="h-full w-full bg-white p04">
      {
        step === "a" && window.Fuzzer?.hit(1) && (
          <>
            <h1 className="text-black">Step A</h1>
            <button data-fuzz-id="1" onClick={() => setStep("b")} className="bg-blue-500 text-white px-4 py-2 mt-2">to B</button>
          </>
        )
      }
      {
        step === "b" && window.Fuzzer?.hit(2) && (
          <>
            <h1 className="text-black">Step B</h1>
            <button data-fuzz-id="2" onClick={() => setStep("a")} className="bg-blue-500 text-white px-4 py-2 mt-2">to A</button>
            <button data-fuzz-id="3" onClick={() => setStep("c")} className="bg-blue-500 text-white px-4 py-2 mt-2">to C</button>
          </>
        )
      }
      {
        step === "c" && window.Fuzzer?.hit(3) && (
          <>
            <h1 className="text-black">Step C</h1>
            <button data-fuzz-id="4" onClick={() => setStep("b")} className="bg-blue-500 text-white px-4 py-2 mt-2">to B!!! from C</button>
          </>
        )
      }
    </div>
  );
}

```

Let's consider a unique state to be defined by its unique code path, represented by the unique identifiers passed to the `Fuzzer.hit()` method. If we re-render the above component with a step of "a", it would end up calling `hit()` with values (0, 1). Compare this to a step of "c", which would call `hit()` with values (0, 3). This would be enough to represent two of the three unique states of this component.

There are additional considerations to take into account that will become clear in the full babel plugin code, such as skipping blocks/functions that explicitly fire as part of click handlers, etc. The full plugin can be found [here](https://github.com/trevorstenson/react-fuzzer/blob/main/src/plugins/fuzzmap.ts).

## Input

With a React component as a fuzz target (or really any web frontend), we can see that there is a wide range of interactions that can be considered "input" (any interaction one can trigger with their mouse/ or keyboard). This prototype isn't intended to support handling them all. While I intend to expand support for other types of inputs/interactions, we will consider just the following as the primary valid "fuzzable" inputs for now:

- Buttons
- Text inputs
- Radio inputs

There is a distinct way a user interacts with each of these types. For buttons and radios, users click to either trigger an action or toggle between states. Text inputs have some additional complexity, which I will address later.

## Tracking States and Interactions

The `Fuzzer` class is responsible for recording all relationships between states and the inputs required to reach them. When fuzzing a component, the fuzzer generally follows this order:

1. Render the initial instrumented component and record the initial state.
2. Detect any inputs marked as a valid fuzz input with the `data-fuzz-input` attribute, and add them to the fuzzing queue with the current state. The queue is a list of pairs, each consisting of an input to try from a given start state.
3. While the queue is not empty, pop the next input and state from the queue and simulate the input.
4. If a new state is reached, record any new inputs marked as fuzz input. If the state is not new, do not record any new inputs.
5. Repeat until the queue is empty.

By following this process, the fuzzer will generate a complete graph representation of all possible states and the interactions required to reach them, making the actual visualization a relatively simple final step.

### Hitmaps and Clamping

A Hitmap is the type used for a unique code path representing a state. Keys represent the identifier of the unique block of code "hit" during component rendering, and the value indicates the number of times that block was hit. For the first `SimpleComponent` example, the hitmap would look like this:

```typescript
export type Hitmap = Map<number, number>;

const hitmap: Hitmap = new Map([
  [0, 1],
  [1, 1],
]);
console.log(hitmap);
// Map(2) { 0 => 1, 1 => 1 }
```

As mentioned earlier, there is a major problem with using code path execution to identify states in the domain of web applications. If we render any sort of list or iterate over an array, the difference in the number of iterations would cause a different hitmap to be generated, even if the user sees the exact same state (or something that is functionally the same). For example, if a list renders 73 versus 74 items, do we want to tell the user that these are two different states?

To address this, we will consider these states to be the same through a process called "clamping".

Clamping involves taking a hitmap and reducing all hit counts to 1 by simply setting all values to 1. This means we are only interested in the unique code paths executed, not the number of times they were executed.

```typescript
const example_hit_map: Hitmap = new Map([
  [0, 4],
  [1, 1],
  [3, 73]
]);
const clamped = clamp_hit_map(example_hit_map);
console.log(clamped);
// Map(3) { 0 => 1, 1 => 1, 3 => 1 }
```

The clamped version of a state's hitmap is used as a key for all major operations in the fuzzer. Although this is a lossy operation, it is key to finding a balance between the number of states and the user's perception of what constitutes a unique state.

### ResultMap

When tracking a new state, we take the hitmap executed to reach that state, the action that triggered this code path, and a screenshot of the rendered DOM at that point (for visualization purposes), and save it to the `ResultMap` object. This is used for associating hitmaps with their human-understandable state representation and serves as the primary source of data for rendering a useful visualization.

```typescript
export type FuzzerResultKey = {
  start_hitmap: HitmapHash;
  action_id: number;
  description: string;
};

export type FuzzerResultValue = {
  hitmap: HitmapHash;
  html: string;        // rendered html
  img_capture: string; // base64 encoded image
};

export type ResultMap = Map<FuzzerResultKey, FuzzerResultValue>;
```

## Visualization

For providing a useful visualization of the final `ResultMap` object to the user, I used [`reactflow`](https://reactflow.dev/). Nodes depict states by using a combination of the hitmap and the captured screenshot of the rendered DOM. Edges highlight interactions between states and are labeled with any metadata associated with an action.

## Running through an example

Looking at the component above, you can intuit that there are three unique states to be reached by clicking the buttons. The fuzzer should be able to detect the same thing and highlight the relationships between them through inputs/user interactions.

Let's call the states A, B, and C. First, we mount the component and record the initial state, A. After processing fuzzable inputs, our queue of interactions to try looks something like this:

```js
[
  {
    state: "A",
    action: {
      elm_id: 1, // fuzz id
      type: "click",
    }
  }
]
```

Popping the only available action from the queue, we trigger the button with `fuzz-id=1` and transition to state B. New inputs are pushed to the queue, and the process repeats until it is empty. The actual flow of the fuzzer is as follows:

- **State A**, Q: [(A, 1)]
  - click button 1, transition to state B
- **State B**, Q: [(B, 2), (B, 3)]
 - click button 2, transition to state A
- **State A**, Q: [(B, 3)]
  - **No valid inputs from state A. Travel to closest state with valid inputs: B**
- **State B**, Q: [(B, 3)]
  - click button 3, transition to state C
- **State C**, Q: [(C, 4)]
  - click button 4, transition to state B
- **State B**, Q: []

Here is the visualization of the above example:

![Fuzzer visualization](example-viz.png)

## Limitations

Currently, there are several issues with this approach that make it far from a fully useful solution.

The obvious limitation is determining sensible values for certain types of inputs. Not only can text inputs take any arbitrary value, but the types of strings you insert require contextual knowledge of the entire application. For example, it may be obvious to the user that a certain text input is related to setting a username and should only consider alphanumeric values without spaces. By testing using only code path instrumentation, there is no way to reliably determine what is reasonable without additional direction from the user.

The complexity of real production components and environments is another obstacle to treating this as a seriously useful tool. For simple toy components, we can treat them as if they are isolated functions living in a vacuum with no reliance on external state. As a result, all rendering logic is controlled by state that can only be modified through our instrumented input/interaction with the component. In any real application, state isn't that simple. There can be numerous pieces of "dynamic" data that rely on external or environmental states such as API calls, time of day, location, etc. If any block of code executes differently, you'd end up with a new state. This means using such a fuzzer on anything more complex than relatively isolated components would be extremely challenging.

If I continue working on this in the future, I would like to explore the following areas:

- **Smarter instrumentation**: Currently, any arbitrary block statements are being instrumented. This works, but it would be more efficient to only instrument blocks that are actually relevant to the component's rendering logic.
- **Complex input support**: As mentioned earlier, the support for highly variable inputs like text is lacking. Providing the ability for user-defined strategies on an input-by-input basis based on context, or the ability to have predefined strategies for certain types of inputs, would be a good start.
- **Combining other fuzzing approaches**: Combining this approach with others, such as genetic algorithms or vision-based analysis/diffing to determine states, would be interesting. By integrating heuristics from other related tools, we could potentially achieve a more complete and reliable picture of component behavior.

To take a look at the code and use it for yourself, [check out the repository](https://github.com/trevorstenson/react-fuzzer).

I've had this idea bouncing around my head for a while, and I'm glad I finally got around to implementing some version of it. If anyone has any thoughts or suggestions, I'd love to hear them!
