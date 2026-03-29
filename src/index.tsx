import { Elysia, t } from "elysia";
import { html, Html } from '@elysiajs/html'
import { staticPlugin } from '@elysiajs/static'
import { randomBytes } from 'node:crypto'
import { eventStream } from './component'

const state = {numbers: new Array(64).fill(0), count: 0};

type ViewState = {viewId: string, color?: "green" | "red"}
const viewStates = new Map<string, ViewState>()

function getViewState(viewId: string): ViewState {
  let vs = viewStates.get(viewId);
  if (!vs) { vs = {viewId}; viewStates.set(viewId, vs); }
  return vs;
}

function signals({state}: {state: {count: number}}): string {
  return `{"_count": ${state.count}}`
}

function Render({state, viewState}: {state: {numbers: number[], count: number}, viewState: ViewState}): string {
  viewState.color ??= 'green';
  return (
    <div id="grid" data-signals:view-id={`'${viewState.viewId}'`} data-on-signal-patch-filter='{"exclude": /^_.*/}' data-on-signal-patch="@post('/update')">
    <div data-init="@get('/stream')" class="grid grid-cols-8 gap-1 w-64" data-effect="history.replaceState(null, '', `?n=${$_count}`)">
      {Array.from({ length: 64 }, (_, i) => (
	<div
	  id={`cell-${i}`}
	  class={`flex items-center justify-center aspect-square border border-gray-300 rounded text-sm bg-${viewState.color}-300`}
	>
	  {state.numbers[i]}
	</div>
      ))}
    </div>
      <button data-on:click="$color = 'red'">Red</button>
    </div>) as string;
}

const bus = new EventTarget();

const app = new Elysia()
.use(html())
.use(staticPlugin({ assets: 'public' }))
.get("/", () => {
  const viewState = {viewId: randomBytes(20).toBase64({alphabet: 'base64url'})}

  return (
    <html lang="en">
      <head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>App</title>
	<link rel="stylesheet" href="/public/styles.css" />
	<script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.8/bundles/datastar.js"></script>
      </head>
      <body>
	<Render state={state} viewState={viewState}/>
      </body>
    </html>
  )})
.get("/stream", ({ headers, query }) => {
  const args = JSON.parse(query.datastar)!;
  const viewState = getViewState(args.viewId)
  // In practice, state would come from database.
  const component = {render: Render, signals}
  const acceptEncoding = headers['accept-encoding']
  Object.assign(viewState, args);
  return eventStream({...component, bus, state, viewState, acceptEncoding})
}, {query: t.Object({datastar: t.String()})})
.post("/update", async ({request}) => {
  const body = await request.json();
  Object.assign(getViewState(body.viewId), body);
  console.log("UPDATE");
  bus.dispatchEvent(new Event(body.viewId));
  return ''
})
.listen({hostname: '0.0.0.0', port: 3000})

function pollUpdate() {
  state.numbers[(Math.random() * 64)|0] = (Math.random() * 100) | 0;
  state.count++;
  bus.dispatchEvent(new CustomEvent("*"));
}
setInterval(pollUpdate, 1000)

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
