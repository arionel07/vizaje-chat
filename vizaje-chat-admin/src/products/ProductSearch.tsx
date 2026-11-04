import { ArrowLeft, Copy, ExternalLink, Package, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { searchProducts, type Product } from '../lib/api'

const SEARCH_DEBOUNCE_MS = 350
const COPIED_RESET_MS = 1500

function ProductThumb({ product, size = 'h-10 w-10' }: { product: Product; size?: string }) {
	const [broken, setBroken] = useState(false)
	if (!product.imageUrl || broken) {
		return (
			<span
				className={`flex ${size} shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400 dark:bg-zinc-800`}
			>
				<Package aria-hidden="true" className="h-1/2 w-1/2" />
			</span>
		)
	}
	return (
		<img
			src={product.imageUrl}
			alt=""
			loading="lazy"
			onError={() => setBroken(true)}
			className={`${size} shrink-0 rounded-lg border border-zinc-200 object-cover dark:border-zinc-800`}
		/>
	)
}

// карточка товара — то, во что превращается выпадашка после клика на
// результат: картинка, название, SKU, штрихкод, варианты (если есть),
// ссылка — скопировать или сразу открыть в новой вкладке
function ProductCard({
	product,
	onBack,
	onCopy,
	copied
}: {
	product: Product
	onBack: () => void
	onCopy: () => void
	copied: boolean
}) {
	const hasVariantDetails = product.variantSkus.length > 0 || product.variantBarcodes.length > 0
	return (
		<div className="p-3">
			<button
				type="button"
				onClick={onBack}
				className="mb-2 flex cursor-pointer items-center gap-1 rounded-lg border-0 bg-transparent p-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
			>
				<ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
				Назад к результатам
			</button>
			<div className="flex gap-3">
				<ProductThumb product={product} size="h-20 w-20" />
				<div className="min-w-0 flex-1">
					<p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{product.title}</p>
					<p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{product.brand}</p>
					<dl className="mt-2 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
						<div className="flex gap-1">
							<dt className="font-medium text-zinc-500 dark:text-zinc-500">SKU:</dt>
							<dd>{product.sku}</dd>
						</div>
						{product.barcode && (
							<div className="flex gap-1">
								<dt className="font-medium text-zinc-500 dark:text-zinc-500">Штрихкод:</dt>
								<dd>{product.barcode}</dd>
							</div>
						)}
					</dl>
				</div>
			</div>
			{product.hasVariants && (
				<div className="mt-3 rounded-lg bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
					<p className="font-medium text-zinc-500 dark:text-zinc-500">Варианты</p>
					{hasVariantDetails ? (
						<>
							{product.variantSkus.length > 0 && (
								<p className="mt-0.5">SKU: {product.variantSkus.join(', ')}</p>
							)}
							{product.variantBarcodes.length > 0 && (
								<p className="mt-0.5">Штрихкоды: {product.variantBarcodes.join(', ')}</p>
							)}
						</>
					) : (
						<p className="mt-0.5">У товара есть варианты — подробности на сайте</p>
					)}
				</div>
			)}
			<div className="mt-3 flex gap-2">
				<button
					type="button"
					onClick={onCopy}
					className="flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
				>
					<Copy aria-hidden="true" className="h-3.5 w-3.5" />
					{copied ? 'Скопировано' : 'Скопировать ссылку'}
				</button>
				<a
					href={product.url}
					target="_blank"
					rel="noopener noreferrer"
					aria-label="Открыть на сайте"
					title="Открыть на сайте"
					className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-zinc-300 text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
				>
					<ExternalLink aria-hidden="true" className="h-4 w-4" />
				</a>
			</div>
		</div>
	)
}

// ссылку копируем через Clipboard API; в браузерах без него (или без
// разрешения) — запасной вариант через скрытый textarea (тот же приём,
// что при копировании текста сообщения в виджете, см. widget.js)
async function copyToClipboard(text: string) {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text)
			return
		} catch {
			// падаем в запасной вариант ниже
		}
	}
	const ta = document.createElement('textarea')
	ta.value = text
	ta.style.position = 'fixed'
	ta.style.opacity = '0'
	document.body.appendChild(ta)
	ta.select()
	try {
		document.execCommand('copy')
	} catch {}
	ta.remove()
}

// поиск товаров по SKU/штрихкоду/названию (Meilisearch легаси-сайта) —
// второй режим переключателя рядом с поиском по беседам в ConversationList.
// Результаты — выпадашка под полем; клик по товару превращает её в мини-карточку
export function ProductSearch({ token }: { token: string }) {
	const [input, setInput] = useState('')
	const [query, setQuery] = useState('')
	const [results, setResults] = useState<Product[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [selected, setSelected] = useState<Product | null>(null)
	const [copied, setCopied] = useState(false)
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const wrapRef = useRef<HTMLDivElement>(null)
	const [open, setOpen] = useState(false)

	function handleInput(value: string) {
		setInput(value)
		setSelected(null)
		setOpen(true)
		clearTimeout(timerRef.current)
		const trimmed = value.trim()
		if (!trimmed) {
			// очистили поле — сбрасываем сразу, не дожидаясь debounce и не через effect
			setQuery('')
			setResults([])
			setLoading(false)
			setError(null)
			return
		}
		// setLoading здесь же, не в эффекте по смене query — тот же приём, что в
		// ConversationList.handleSearchInput: эффект только читает актуальный query,
		// а не запускает побочные setState синхронно сам по себе
		timerRef.current = setTimeout(() => {
			setLoading(true)
			setError(null)
			setQuery(trimmed)
		}, SEARCH_DEBOUNCE_MS)
	}

	function clear() {
		clearTimeout(timerRef.current)
		setInput('')
		setQuery('')
		setResults([])
		setSelected(null)
		setError(null)
	}

	useEffect(
		() => () => {
			clearTimeout(timerRef.current)
			clearTimeout(copyTimerRef.current)
		},
		[]
	)

	// канонический отменяемый fetch-эффект (active-флаг в замыкании вместо
	// AbortController — ответ всё равно отбрасывается, не прерывается на лету):
	// при смене query/token до завершения предыдущего запроса его результат
	// просто игнорируется, не перетирая более новый поиск
	useEffect(() => {
		if (!query) return
		let active = true
		async function run() {
			try {
				const items = await searchProducts(token, query)
				if (active) setResults(items)
			} catch (e) {
				if (active) setError(e instanceof Error ? e.message : 'Не удалось выполнить поиск')
			} finally {
				if (active) setLoading(false)
			}
		}
		run()
		return () => {
			active = false
		}
	}, [token, query])

	// клик вне поля/выпадашки или Escape — закрыть (сам поиск и результаты не сбрасываем,
	// чтобы при повторном фокусе снова увидеть то же самое)
	useEffect(() => {
		function handlePointerDown(e: PointerEvent) {
			if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
		}
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') setOpen(false)
		}
		document.addEventListener('pointerdown', handlePointerDown)
		document.addEventListener('keydown', handleKeyDown)
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown)
			document.removeEventListener('keydown', handleKeyDown)
		}
	}, [])

	async function handleCopy() {
		if (!selected) return
		await copyToClipboard(selected.url)
		setCopied(true)
		clearTimeout(copyTimerRef.current)
		copyTimerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS)
	}

	const showDropdown = open && (loading || error || results.length > 0 || selected || (query && !loading))

	return (
		<div ref={wrapRef} className="relative">
			<div className="relative">
				<Search
					aria-hidden="true"
					className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
				/>
				<input
					type="text"
					value={input}
					onChange={e => handleInput(e.target.value)}
					onFocus={() => setOpen(true)}
					placeholder="SKU, штрихкод или название…"
					aria-label="Поиск по товарам"
					className="h-10 w-full rounded-lg border border-zinc-300 bg-white pl-9 pr-9 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-300 dark:focus:ring-zinc-300/20"
				/>
				{input && (
					<button
						type="button"
						onClick={clear}
						aria-label="Очистить поиск"
						className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
					>
						<X aria-hidden="true" className="h-4 w-4" />
					</button>
				)}
			</div>

			{showDropdown && (
				<div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-[26rem] overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
					{selected ? (
						<ProductCard
							product={selected}
							onBack={() => setSelected(null)}
							onCopy={handleCopy}
							copied={copied}
						/>
					) : loading ? (
						<p className="px-3 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">Ищем…</p>
					) : error ? (
						<p className="px-3 py-6 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
					) : results.length === 0 ? (
						<p className="px-3 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
							Ничего не найдено
						</p>
					) : (
						<ul className="m-0 flex list-none flex-col gap-0.5 p-2">
							{results.map(p => (
								<li key={p.sku}>
									<button
										type="button"
										onClick={() => setSelected(p)}
										className="flex w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
									>
										<ProductThumb product={p} />
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
												{p.title}
											</span>
											<span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
												{p.brand} · SKU {p.sku}
											</span>
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			)}
		</div>
	)
}
