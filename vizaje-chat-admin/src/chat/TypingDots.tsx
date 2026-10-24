// Три пульсирующие точки: «собеседник печатает»
export function TypingDots({ label }: { label: string }) {
	return (
		<span role="status" aria-label={label} className="inline-flex items-center gap-1">
			{[0, 200, 400].map(delay => (
				<span
					key={delay}
					aria-hidden="true"
					style={{ animationDelay: `${delay}ms` }}
					className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-zinc-400 motion-reduce:animate-none dark:bg-zinc-500"
				/>
			))}
		</span>
	)
}
