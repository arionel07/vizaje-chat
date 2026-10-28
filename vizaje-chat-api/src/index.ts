import { createApp } from './app'
import { setPublisher } from './chat/events'
import { PORT } from './config'
import { startAttachmentCleanup } from './uploads/cleanup'

const app = createApp().listen(PORT)

setPublisher((room, payload) => app.server?.publish(room, payload))
startAttachmentCleanup()

console.log(`🦊 running at http://localhost:${app.server?.port}`)
