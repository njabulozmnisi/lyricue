// LyriCue library publish Worker.
// Per architecture.md §8.2 — fronts a Cloudflare R2 bucket for credentialed writes
// and rebuilds catalog.json on each successful publish.
//
// Full implementation lands in EP-14 STORY-14.1.
// At EP-01 scaffold time, this is a stub that returns 501 for everything,
// so the wrangler build pipeline at least has something to compile.

export interface Env {
    LIBRARY: R2Bucket
    CREDENTIALS: KVNamespace
}

export default {
    async fetch(request: Request, _env: Env): Promise<Response> {
        const url = new URL(request.url)
        return new Response(
            JSON.stringify({
                error: "not_implemented",
                message: `Publish Worker scaffold. Endpoint ${request.method} ${url.pathname} lands in EP-14 STORY-14.1.`
            }),
            {
                status: 501,
                headers: { "content-type": "application/json" }
            }
        )
    }
} satisfies ExportedHandler<Env>
