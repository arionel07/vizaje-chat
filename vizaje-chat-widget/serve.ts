// Локальный сервер для тестовой страницы виджета:
//   bun run serve.ts --port 8080   (или: bun run dev --port 8080)
const args = Bun.argv.slice(2)
const i = args.indexOf('--port')
const port = i !== -1 ? Number(args[i + 1]) : 8080

if (!Number.isInteger(port) || port < 1 || port > 65535) {
	console.error('Invalid --port value')
	process.exit(1)
}

const files: Record<string, string> = {
	'/': 'index.html',
	'/index.html': 'index.html',
	'/widget.js': 'widget.js'
}

Bun.serve({
	port,
	fetch(req) {
		const pathname = new URL(req.url).pathname
		if (pathname === '/favicon.ico') return new Response(null, { status: 204 })
		const name = files[pathname]
		if (!name) return new Response('Not found', { status: 404 })
		return new Response(Bun.file(new URL(name, import.meta.url).pathname))
	}
})

console.log(`Widget test page: http://localhost:${port}`)
