import { createAdmin } from '../auth/service'

const email = process.argv[2]
const password = process.argv[3]

if (!email || !password) {
	console.error('Usage: bun run src/scripts/create-admin.ts <email> <password>')
	process.exit(1)
}

await createAdmin(email, password)
console.log(`Admin created: ${email}`)
process.exit(0)
