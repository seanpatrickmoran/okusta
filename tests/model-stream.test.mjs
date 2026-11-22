import assert from "node:assert/strict";
import test from "node:test";
import {generateNote, makePayload} from "../src/model.js";

const model = "Qwen/Qwen3-4B-Instruct-2507";
const clip = {id: "test", text: "Signal increased.", source: {title: "Paper", url: "https://example.org/"}};
const bytes = new TextEncoder();
const event = text => 'data: ' + JSON.stringify({choices: [{delta: {content: text}}]}) + '\r\n\r\n';

test("shows a partial answer before completion and accepts DONE on an open connection", {timeout: 3000}, async t => {
  let controller;
  const response = new Response(new ReadableStream({start(c) { controller = c; }}));
  t.mock.method(globalThis, "fetch", async () => response);
  let first;
  const received = new Promise(resolve => { first = resolve; });
  const result = generateNote(model, clip, first);
  const packet = bytes.encode(event("Δ signal"));
  const split = packet.indexOf(0xce) + 1;
  controller.enqueue(packet.subarray(0, split));
  controller.enqueue(packet.subarray(split));
  assert.equal(await received, "Δ signal");
  controller.enqueue(bytes.encode(event(" increased.") + 'data: [DONE]\n\n'));
  assert.equal((await result).text, "Δ signal increased.");
});

test("an empty or interrupted stream produces a visible error message for the caller", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response('data: [DONE]\n\n'));
  await assert.rejects(generateNote(model, clip), /no answer text/);
  fetch.mock.mockImplementation(async () => new Response(event("Partial reply")));
  await assert.rejects(generateNote(model, clip), /stream ended early/);
});

test("a direct question includes only the current clipping and the user's question", async t => {
  const source = {...clip, element: "table", text: "Metric\tValue\nMSE\t2"};
  const question = "Which metric has a value of 2?";
  let request;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    request = JSON.parse(options.body);
    return Response.json({choices: [{message: {content: "MSE."}}]});
  });
  const answer = await generateNote(model, source, undefined, question);
  assert.equal(answer.text, "MSE.");
  assert.match(request.messages[0].content, /answer the user’s latest question/i);
  const [context, task] = request.messages[1].content.split("\n\n");
  const sourceBlock = context.split("WEBPAGE CONTEXT (UNTRUSTED SOURCE DATA):\n")[1];
  assert.equal(task, "USER QUESTION:\n" + question);
  assert.equal(request.max_tokens, 4096);
  assert.deepEqual(JSON.parse(sourceBlock), {
    clipping_id: source.id, source: source.source, capture: {kind: "element", tag: "table"},
    selection: source.text
  });
});


test("model source metadata includes only the page origin and path", () => {
  const source = {...clip, source: {title: "Article", url: "https://reader:example@site.test/read?session=example#notes"}};
  assert.equal(makePayload(source).source.url, "https://site.test/read");
  assert.ok(source.source.url.includes("?session="));
});

test("a follow-up can change topic without asking the model to explain the clipping again", async t => {
  const source = {...clip, text: "A vessel was reported in the Gulf of Finland."};
  const history = [{role: "user", content: "Where was the vessel?"}, {role: "assistant", content: "In the Gulf of Finland."}];
  const question = "Is Finland a NATO member?";
  let messages;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    messages = JSON.parse(options.body).messages;
    return Response.json({choices: [{message: {content: "Fixture reply"}}]});
  });
  await generateNote(model, source, undefined, question, {history});
  assert.match(messages[0].content, /general knowledge/);
  assert.match(messages[0].content, /what the article says/);
  assert.match(messages[1].content, /Gulf of Finland/);
  assert.ok(messages[1].content.endsWith(history[0].content));
  assert.doesNotMatch(messages[1].content, /Explain the selected material/);
  assert.deepEqual(messages.slice(2), [history[1], {role: "user", content: question}]);
});

test("both completion formats preserve partial text and distinguish a length stop", async t => {
  const choice = {finish_reason: "length", message: {content: "Part of an answer"}};
  const call = t.mock.method(globalThis, "fetch", async () => Response.json({choices: [choice]}));
  const result = await generateNote(model, clip);
  assert.equal(result.finishReason, "length");
  assert.equal(result.text, "Part of an answer");
  assert.equal(JSON.parse(call.mock.calls[0].arguments[1].body).max_tokens, 2048);
  call.mock.mockImplementation(async () => new Response(event("Part of an answer") +
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'));
  assert.deepEqual(await generateNote(model, clip), result);
});

test("local requests use the selected output limits and preserve the entire selection", async t => {
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return Response.json({choices: [{message: {content: "Answer"}, finish_reason: "stop"}]});
  });
  const large = {...clip, text: "paragraph ".repeat(12000) + "LAST LINE"};
  const route = {limits: {noteTokens: 1500, questionTokens: 3500}};
  await generateNote(model, large, undefined, "", route);
  await generateNote(model, large, undefined, "Explain?", route);
  assert.deepEqual(bodies.map(b => b.max_tokens), [1500, 3500]);
  for (const body of bodies) {
    const source = JSON.parse(body.messages[1].content.split("SOURCE DATA):\n")[1].split("\n\n")[0]);
    assert.equal(source.selection, large.text);
  }
});

test("active streams can last longer than the inactivity timeout", async t => {
  t.mock.timers.enable({apis: ["setTimeout"]});
  let controller, signal, notify;
  t.mock.method(globalThis, "fetch", async (_url, opts) => {
    signal = opts.signal;
    return new Response(new ReadableStream({start(c) { controller = c; }}));
  });
  const result = generateNote(model, clip, text => notify(text));
  for (const part of ["First", " second", " third"]) {
    const received = new Promise(resolve => { notify = resolve; });
    t.mock.timers.tick(70000);
    controller.enqueue(bytes.encode(event(part)));
    await received;
    assert.equal(signal.aborted, false);
  }
  controller.enqueue(bytes.encode("data: [DONE]\n\n"));
  assert.equal((await result).text, "First second third");
});
