---
title: "Rewriting Requests with GPT-3"
date: "2023-02-19"
tags: ["AI", "javascript"]
description: "Generating webpages on-the-fly with GPT-3"
---

[In my last post](/proxies-chatgpt), I took advantage of the dynamic nature of the Proxy object to intercept invocations to non-existent methods, infer meaning from their name and arguments, and generate output from GPT-3 at runtime. It was fun to create a new way for someone to interact with GPT-3 directly from the words that make up a fundamental language construct such as a method call, but ultimately is not that useful.

At a basic level, the output of current language models are just text, or a textual representation of some other data type that needs to be parsed. I did not want to deal with any parsing in the Proxy version, since the output returned could represent anything. This made it impossible to type the returned value to anything other than a raw `string`.

To make something more practical, I wanted to constrain this idea of using LLMs for runtime output generation to a specific domain. My immediate thought was to apply this to the domain of web frontends. If we can dynamically create return values for functions at runtime, why can't we apply the same idea to full webpages and applications?

![Moving from functions to webpage responses](gpt-process.png)

Now, I have no doubt that implementations of this idea are out there. However, keeping in the lightweight spirit of the original idea, I wanted to take this a step further and see if it was possible to do without any backend server or processing being done outside the client. Let's go!

## Service-Worker-as-a-Backend

[Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) are one of those tools that you don't really grasp the power or usefulness of until you run into a situation that demands them. One of the fundamental technologies enabling the (slow) adoption of Progressive Web Apps (PWAs), Service Workers can be thought of as a thin proxy server that sits between web applications running in a browser and the network.

![Service Worker routing](sw-pathway.png)

They are a special type of [Worker](https://developer.mozilla.org/en-US/docs/Web/API/Worker) that provides functionality to solve common problems related to enabling offline functionality, increase performance of web applications, as well as a whole host of other persistence and network related tasks. One runs on a separate thread with no access to the DOM, and has a lifecycle that is separate from the main application. This means that a simple page refresh will not destroy or even restart a service worker, which means it is able to persist state between page loads.

In a more concrete sense, they can do things like aggressively cache resources locally to improve request times and provide graceful request fallback behavior when the network is inconsistent or unavailable. Most importantly for our purposes, a service worker has the ability to intercept requests just before they are sent to the network and manipulate or redirect the request and response properties as it sees fit.

## Intercepting Requests

Service workers respond to applications using an event-driven architecture. An application registers a service worker in the browser, which is then installed and activated. Once set up, the worker listens for events and can handle them as it sees fit or simply ignore them.

Conveniently for us, one of the primary events that we can listen to is the `fetch` [event](https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent). This is of course fired whenever a client application makes a network request using something like the native `fetch()` web API.

Let's set up a basic service worker and test listening to the `fetch` event. In order do this, we will need a simple HTML page served from a static HTTP server, as well as a `sw.js` file that will contain our service worker code:

```html
<html>
  <head>
    <script>
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js");
      }
    </script>
  </head>
  <body>
    <h1>Test webpage</h1>
    <button onclick="fetch('/')">Fetch</button>
  </body>
</html>
```

```js
// force the service worker to install and activate immediately
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

// use clients.claim() to take control of all clients immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  console.log("got fetch", event.request.url);
});
```

In the above example, we register a service worker at `sw.js` and listen for the `fetch` event. If we cause the event to fire using the button, we simply log the URL of the request to the console. If we load this page in a browser, we should see `got fetch http://127.0.0.1:8080/` in the console.

You may be wondering what the point of the `install` and `activate` handlers is. The `install` handler is fired when the service worker is first installed, and the `activate` handler is fired when the service worker is activated and is useful for performing any setup tasks that need to be done before the service worker is activated.

In our case, we simply want to force the service worker to activate immediately, so we call `event.waitUntil(self.skipWaiting())` to skip the waiting phase and activate immediately. Similarly, when the service worker is activated, we want to call `event.waitUntil(self.clients.claim())` to take control of all clients immediately. The reasoning for this will become apparent later.

## Rewriting Requests

Now that we can catch and get information about requests, we need to prevent them from being sent so that we can inject our own response content instead. Before we integrate this with an LLM, let's just overwrite every request for a resource from our server with a simple plain text response:

```js
// utility to intercept relative path requests from our own server for now
const should_intercept = (url) => {
  return url.origin === self.location.origin && url.pathname !== "/";
};
const fetch_interceptor = (event) => {
  const url = new URL(event.request.url);
  if (!should_intercept(url)) return;
  event.respondWith(
    new Response("Hello from the service worker!", {
      headers: { "Content-Type": "text/plain" },
    })
  );
};

self.addEventListener("fetch", fetch_interceptor);
```

If we run a static HTTP server hosting the initial HTML page with the new service worker fetch handler, you will initially see the original page content.

![Initial page load](initial-page.png)

However, if you try to navigate to any other (real or non-existent) page on the site (i.e `http://127.0.0.1:8080/test`), you will now immediately see a page containing the plain text `"Hello from the service worker!"`.

![Rewritten response](rewritten-response.png)

This means for any page or arbitrary path, we have the ability to short-circuit the request, do whatever we want with it, and return back a `Response` object containing whatever we want.

## Tying It All Together

The only thing really left to do is to:

1. Construct a meaningful prompt from the `Request` object and its metadata
2. Use this to generate a GPT-3 response and force the client to wait for this background processing to complete
3. Respond back to the initial client request with a well-formed `Response` object to be rendered by the browser

Let's start with the easiest way of creating a prompt from basic request information. What better way to do this than using the path included in the request URL? A simple implementation of this would be splitting the path into words by dashes/underscores and building a sentence from it.

We should also support a basic form of query parameters, which we can do by simply appending the values of the query parameters to the end of the prompt if they exist. Let's also preface the constructed prompt with a simple directive to constrain the model into generating output that can be rendered as valid HTML:

```js
const make_prompt = (url) => {
  let prompt = url.pathname.replace(/\//, "").split(/-|_/).join(" ");
  if (url.search !== "") {
    const query_args = new URLSearchParams(url.search).values();
    let final_values = [];
    for (const value of query_args) {
      final_values.push(value);
    }
    if (final_values.length > 0) {
      prompt = `${prompt}:\n${final_values.join(", ")}`;
    }
  }
  prompt = `
  Create a well formed webpage using HTML, CSS, and JavaScript that contains the output of the following prompt:\n${prompt}
  `;
  return prompt;
};
```

Here are some example URL to prompt conversions:

```bash
http://127.0.0.1:8080/page_with_three_red_boxes

Create a well formed webpage using HTML, CSS, and JavaScript that contains the output of the following prompt:
page with three red boxes
```

```bash
Create a well formed webpage using HTML, CSS, and JavaScript that contains the output of the following prompt:
what is the capital of:
canada
```

Now that we have a prompt, we need to pipe it into GPT-3, wait for it to generate a response, and then return that response back to the client. We can do this by making our own `fetch` request to the OpenAI API and then returning a `Response` object containing the generated HTML:

```js
const fetch_interceptor = (event) => {
  const url = new URL(event.request.url);
  if (!should_intercept(url)) return;
  const prompt = make_prompt(url);
  const open_ai_req = new Promise((resolve) => {
    // this is a standard OpenAI API call to https://api.openai.com/v1/completions
    openai_request(prompt).then((data) => {
      resolve(
        new Response(data, {
          headers: {
            "Content-Type": "text/html", // interpret our response text as HTML
          },
        })
      );
    });
  });
  event.respondWith(open_ai_req);
};
```

In the above example, we are calling `event.respondWith()` with a `Promise` object that will eventually resolve to a `Response` containing generated HTML from GPT-3. This allows us to force the client to wait for the GPT-3 response to be generated before rendering the page.

To the user it will look like the page is taking a long time to load, but in reality the service worker is dynamically generating the content for the next page from GPT-3 on the fly.

Even this basic implementation is enough to generate some interesting results. We can generate anything from basic functional React applications, to simple static sites with a color scheme, as well as animated shapes and images.

Here are some example pages generated from URLs using the above method (click to see live demo):

`/reactjs_working_counter_app` - [Live demo](/reactjs-working-counter-app.html)

`/working_clock_app` - [Live demo](/working-clock-app.html)

`/colorful_page_with_cat` - [Live demo](/colorful_page_with_cat.html)

`/page_with_17_different_animated_shaped_and_gray_background` - [Live demo](/page_with_17_different_animated_shaped_and_gray_background.html)

`/alert_me_the_capital_of?country=canada` - [Live demo](/alert_me_the_capital_of_canada.html)

Since there is no real secure backend, having this project be publicly hosted would require my OpenAI API key to be exposed to the public. If you want to run this project locally, you can simply register a service worker [containing the full source code here](https://gist.github.com/trevorstenson/21510b2fcd00ad41188860174c288c61).

## Conclusion

In this post, we explored how to use a service worker to intercept HTTP requests and, with the help of GPT-3, dynamically generate the content of the next page. The only thing being shipped to the client on initial load is two files:

- the initial HTML page that needs to register the service worker
- and the service worker itself.

Once installed, all future requests are intercepted and handled by GPT-3.

While just parsing the URL pathname into a sentence was enough to get GPT-3 making fully functional mini applications, this is only scratching the surface.

### Improvements

This only handles navigation requests for other pages on the site, and the prompt is solely focused on generating a final representation in the form of HTML. However, we can imagine being more specific during prompt generation to handle requests of different types better.

For example, we could use the `Accept` or `Content-Type` headers to determine what type of content the client is expecting, and then generate a more useful prompt on a per-request basis. Another possibility is maintaining a cache of previously generated pages, and using that to generate more specific prompts if desired. As the official API is charged on a per-token basis, I didn't feel it was worth the cost to implement them, although relatively trivial to do so.

### Possible Tools

I envision a world where ML/language models will greatly improve parts of the web application development feedback loop, or at least make it more enjoyable. Generating assets and views at runtime from just a URL is probably not the most useful application of LLMs, but using their innate ability to identify complex relationships and patterns makes them a better fit for debugging and code completion tools.

Imagine training specific models on a combination of your codebase as well as flows/state changes/interactions in your application at different levels of the stack. Interactions and state changes, while highly coupled together, are represented wildly differently at the DOM level versus the HTTP request/response level.

With a model that only focuses on input, output, and behavior of a complex web application, it isn't too difficult to imagine that model being useful in either aiding to debug an anomalous state/request/output, or even being able to generate appropriate new ones consistently.

For instance, a tool might pop up that uses subtle patterns recognized in the HTTP traffic of your app to identify issues in internal logic, or even suggest fixes. It could even be used to generate new well-formed requests that would trigger the same internal logic, and subsequently use the DOM to identify the corresponding UI elements that would need to be updated.

In 2023, a majority of us have already tested the waters with ML guided debugging or code completion tools. In a short amount of time we've seen just how fast these models can understand and interpret basic code in an isolated context.

Modern web applications can be thought of in simple terms as views expressed as a function of their state. As time goes on, it isn't too far-fetched to imagine these models being used at a higher abstraction level to interpret behaviors of full applications instead of one-off functions.
