import { handoffConversationToOperator } from '../chat/service'
import { searchProducts } from '../products/service'
import { findRestrictedBrand } from './restricted-brands'
import type { ToolDef } from './deepseek'

export const TOOLS: ToolDef[] = [
	{
		type: 'function',
		function: {
			name: 'search_product',
			description:
				'Найти товар в каталоге сайта по названию, бренду, SKU или штрихкоду. Всегда вызывай эту функцию перед тем, как говорить о наличии, цене или вариантах конкретного товара — никогда не отвечай по памяти.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Название товара, бренд, SKU или штрихкод'
					}
				},
				required: ['query'],
				additionalProperties: false
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'handoff_to_operator',
			description:
				'Передать беседу живому оператору — бот после этого больше не отвечает в этой беседе. Используй, когда: бренд/товар не продаётся на сайте (search_product вернул restricted); посетитель жалуется на брак, возврат или проблему с заказом; посетитель сам просит оператора; вопрос, на который ты не можешь ответить. В СВОЁМ ЖЕ текстовом ответе этого хода ты всегда отвечаешь что-то тёплое и по делу — эта функция не заменяет твой ответ, она только помечает беседу для оператора.',
			parameters: {
				type: 'object',
				properties: {
					reasonSummary: {
						type: 'string',
						description:
							'Очень короткое описание ситуации для оператора на русском — о чём шла речь, что нужно посетителю'
					}
				},
				required: ['reasonSummary'],
				additionalProperties: false
			}
		}
	}
]

const SEARCH_RESULT_LIMIT = 5

async function runSearchProduct(query: string) {
	const restricted = findRestrictedBrand(query)
	if (restricted) {
		return { restricted: true, brand: restricted.brand, stores: restricted.stores }
	}
	const products = await searchProducts(query)
	if (products.length === 0) return { found: false }
	return {
		found: true,
		products: products.slice(0, SEARCH_RESULT_LIMIT).map(p => ({
			title: p.title,
			brand: p.brand,
			sku: p.sku,
			inStock: p.inStock,
			url: p.url,
			hasVariants: p.hasVariants
		}))
	}
}

// возвращает JSON-строку — то, что идёт обратно модели как содержимое tool-сообщения
export async function runTool(
	name: string,
	args: Record<string, unknown>,
	conversationId: number
): Promise<string> {
	try {
		if (name === 'search_product') {
			const query = typeof args.query === 'string' ? args.query : ''
			return JSON.stringify(await runSearchProduct(query))
		}
		if (name === 'handoff_to_operator') {
			const summary =
				typeof args.reasonSummary === 'string' && args.reasonSummary.trim()
					? args.reasonSummary.trim()
					: 'без уточнения'
			await handoffConversationToOperator(conversationId, summary)
			return JSON.stringify({ ok: true })
		}
		return JSON.stringify({ error: `Unknown tool: ${name}` })
	} catch (e) {
		return JSON.stringify({ error: e instanceof Error ? e.message : 'Tool execution failed' })
	}
}
