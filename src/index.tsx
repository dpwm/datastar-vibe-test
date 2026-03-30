import { Elysia, t } from "elysia";
import { html, Html } from '@elysiajs/html'
import { staticPlugin } from '@elysiajs/static'
import { randomBytes } from 'node:crypto'
import { eventStream } from './component'
import { createServer } from 'vite'
import { connect } from "elysia-connect-middleware";
import  tailwindcss  from '@tailwindcss/vite'

const state = {numbers: new Array(64).fill(0), count: 0};

type ViewState = {viewId: string, color?: "green" | "red"}
const viewStates = new Map<string, ViewState>()

function getViewState(viewId: string): ViewState {
  let vs = viewStates.get(viewId);
  if (!vs) { vs = {viewId}; viewStates.set(viewId, vs); }
  return vs;
}

const vite = await createServer({ server: { middlewareMode: true }, plugins: [tailwindcss()], appType: 'custom' });

function signals({state}: {state: {count: number}}): string {
  return `{"_count": ${state.count}}`
}

function Layout({children}: {children: JSX.Element | JSX.Element[]}): JSX.Element {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>App</title>
        <link href="/src/style.css" rel="stylesheet" />
        <script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.8/bundles/datastar.js"></script>
      </head>

      <body>
        {children}
      </body>
    </html>
  )
}

function Render({state, viewState}: {state: {numbers: number[], count: number}, viewState: ViewState}): string {
  viewState.color ??= 'green';
  return (
    <Layout>
      <div class="hidden bg-green-500 bg-red-500 bg-blue-500"></div>
      <div data-signals:view-id={`'${viewState.viewId}'`} data-on-signal-patch-filter='{"exclude": /^_.*/}' data-on-signal-patch="@post('/')">
        <div data-init="@get('/')" class="grid grid-cols-8 gap-1 w-64" data-effect="history.replaceState(null, '', `?n=${$_count}`)">
          {Array.from({ length: 64 }, (_, i) => (
            <div

              class={`flex items-center justify-center aspect-square border border-gray-300 rounded text-sm bg-${viewState.color}-500`}
            >
              {state.numbers[i]}
            </div>
          ))}
        </div>
        <div class="flex gap-2 p-2 bg-gray-100 shadow-xl">
        <button class="border-b-4 border-red-500 bg-red-300 p-4" data-on:click="$color='red'" data-on:mousedown="$color = 'red'">Red</button>
        <button class="border-b-4 border-green-500 bg-green-300 p-4 " data-on:click="$color='green'" data-on:mousedown="$color = 'green'">Green</button>
        <button class="border-b-4 border-blue-500 bg-blue-300 p-4 " data-on:click="$color='blue'" data-on:mousedown="$color = 'blue'">Blue</button>
        </div>
      </div>
    </Layout>
  ) as string;
}

const bus = new EventTarget();


const app = new Elysia()
.use(html())
// .use(staticPlugin({ assets: 'public' }))
.use(connect(vite.middlewares))
.get("/", async ({ request, query, headers }) => {
  if (headers['datastar-request']) {
    const args = JSON.parse(query.datastar!);
    const viewState = getViewState(args.viewId)
    const component = {render: Render, signals}
    Object.assign(viewState, args);
    return eventStream({...component, bus, state, viewState, request, htmlTransform: (x) => vite.transformIndexHtml('/', x)})
  } else {
    const viewState = {viewId: randomBytes(20).toBase64({alphabet: 'base64url'})}
    let html = Render({state, viewState});
    html = await vite.transformIndexHtml('/', html);
    return html;
  }
}, {query: t.Object({datastar: t.Optional(t.String())})})
.post("/", async ({request}) => {
  const body = await request.json();
  Object.assign(getViewState(body.viewId), body);
  console.log("UPDATE");
  bus.dispatchEvent(new Event(body.viewId));
  return ''
})
.listen({hostname: '0.0.0.0', port: 3000})

function pollUpdate() {
  state.numbers[(Math.random() * 64)|0] = (Math.random() * 100) | 0;
  // state.count++;
  bus.dispatchEvent(new CustomEvent("*"));
}
setInterval(pollUpdate, 10)

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
