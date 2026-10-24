// lucide-react не включает брендовые иконки (только общие) — классический
// контур камеры Instagram рисуем сами, тем же stroke-набором, что у lucide
// (currentColor, stroke-width 2, round linecap/linejoin), чтобы не выделялся рядом
export function InstagramIcon({ className, 'aria-label': ariaLabel }: { className?: string; 'aria-label'?: string }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			role={ariaLabel ? 'img' : undefined}
			aria-label={ariaLabel}
			aria-hidden={ariaLabel ? undefined : true}
		>
			<rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
			<path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37Z" />
			<line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
		</svg>
	)
}
