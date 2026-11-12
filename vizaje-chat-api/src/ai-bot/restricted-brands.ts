// Бренды, которые по запрету правообладателя не продаются на сайте — только
// в физических магазинах. Список и адреса — от заказчика (не из Meilisearch:
// эти бренды либо отсутствуют в индексе, либо его состав не гарантирует
// актуальность адресов магазинов), проверять вручную при изменении сети магазинов

export type Store = { name: string; address: string }

const MALLDOVA: Store = {
	name: 'Shopping MallDova',
	address: 'Strada Arborilor 21, Chișinău, MD-2025'
}
const PORT_MALL: Store = {
	name: 'PORT MALL',
	address: 'Strada Mihai Sadoveanu 42/6, Chișinău, MD-2075'
}
const OASIS: Store = {
	name: 'OASIS SHOPPING MALL',
	address: 'Strada Bogdan Voievod 1, Chișinău, MD-2068'
}
const UNIC: Store = {
	name: 'UNIC',
	address: 'Bulevardul Ștefan cel Mare și Sfînt 8, Chișinău, MD-2001'
}

// aliases — латиница + частые кириллические варианты написания: посетитель
// почти наверняка напишет «диор»/«шанель», а не «Dior»/«Chanel»
const RESTRICTED_BRANDS: { brand: string; aliases: string[]; stores: Store[] }[] = [
	{ brand: 'Kenzo', aliases: ['kenzo', 'кензо'], stores: [MALLDOVA] },
	{ brand: 'Dior', aliases: ['dior', 'диор'], stores: [MALLDOVA] },
	{ brand: 'Givenchy', aliases: ['givenchy', 'живанши', 'дживанши'], stores: [MALLDOVA] },
	{ brand: 'Guerlain', aliases: ['guerlain', 'герлен', 'герлэн'], stores: [MALLDOVA] },
	{ brand: 'Chanel', aliases: ['chanel', 'шанель'], stores: [MALLDOVA, PORT_MALL, OASIS, UNIC] }
]

// подстрока без учёта регистра по любому из алиасов — запрос «диор крем»
// так же находит Dior, как и «dior cream»
export function findRestrictedBrand(text: string) {
	const lower = text.toLowerCase()
	const match = RESTRICTED_BRANDS.find(({ aliases }) => aliases.some(a => lower.includes(a)))
	return match ? { brand: match.brand, stores: match.stores } : null
}
