import { Elysia } from "elysia";
import { html, Html } from '@elysiajs/html'
import { staticPlugin } from '@elysiajs/static'
import { createBrotliCompress, createGzip, constants } from 'node:zlib'
import { Readable, PassThrough } from 'node:stream'

const app = new Elysia()
    .use(html())
    .use(staticPlugin({ assets: 'public' }))
    .get("/", () => (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>App</title>
                <link rel="stylesheet" href="/public/styles.css" />
                <script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.8/bundles/datastar.js"></script>
            </head>
            <body>
                <div data-init="@get('/stream')">
                    <div class="w-64 grid grid-cols-8 gap-1 p-4">
                    {Array.from({ length: 64 }, (_, i) => (
                        <div
                            id={`cell-${i}`}
                            class="flex items-center justify-center aspect-square border border-gray-300 rounded text-sm"
                        >
                            {i + 1}
                        </div>
                    ))}
                    </div>
                </div>
            </body>
        </html>
    ))
    .get("/stream", ({ headers }) => {
        const acceptEncoding = headers['accept-encoding'] || ''
        const source = new Readable({ read() {} })
        const passthrough = new PassThrough()

        let contentEncoding: string | undefined
        let compressor: any

        if (acceptEncoding.includes('br')) {
            compressor = createBrotliCompress({
                params: {
                    [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
                    [constants.BROTLI_PARAM_QUALITY]: 4,
                },
            })
            source.pipe(compressor).pipe(passthrough)
            contentEncoding = 'br'
        } else if (acceptEncoding.includes('gzip')) {
            compressor = createGzip()
            source.pipe(compressor).pipe(passthrough)
            contentEncoding = 'gzip'
        } else {
            source.pipe(passthrough)
        }

        const interval = setInterval(() => {
            const i = Math.floor(Math.random() * 64)
            const value = Math.floor(Math.random() * 100)
            const event = [
                'event: datastar-patch-elements',
                'data: mode replace',
                'data: elements <div id="cell-' + i + '" class="flex items-center justify-center aspect-square border border-gray-300 rounded text-sm" style="animation: flash-green 1s ease-out;">' + value + '</div>',
                '',
                '',
            ].join('\n')
            source.push(event)
            if (compressor) {
                compressor.flush()
            }
        }, 1)

        const readableStream = Readable.toWeb(passthrough) as unknown as globalThis.ReadableStream
        const responseHeaders: Record<string, string> = {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'connection': 'keep-alive',
        }

        if (contentEncoding) {
            responseHeaders['content-encoding'] = contentEncoding
        }

        return new Response(readableStream, {
            headers: responseHeaders,
        })
    })
    .listen({hostname: '0.0.0.0', port: 3000})

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
