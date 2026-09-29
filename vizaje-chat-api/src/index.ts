import { createApp } from './app'
import { setPublisher } from './chat/events'
import { PORT } from './config'

const app = createApp().listen(PORT)

setPublisher((room, payload) => app.server?.publish(room, payload))

console.log(`🦊 running at http://localhost:${app.server?.port}`)
