export type CardStarSeed = {
	cx: number
	cy: number
	r: number
	opacity: number
	z: number
	delay: number
	duration: number
	twinkleDelay: number
	twinkleDuration: number
	floatX: string
	floatY: string
	floatZ: string
	sparkle?: boolean
	flash?: boolean
	tint?: string
}

const TINTS = ['#ffffff', '#ffffff', '#ffffff', '#e8f1ff', '#d4e4ff', '#ffe6d2']

function mulberry32(seed: number) {
	return () => {
		seed |= 0
		seed = (seed + 0x6d2b79f5) | 0
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function makeStar(
	rand: () => number,
	base: { cx: number; cy: number; r: number; z: number; near?: boolean },
): CardStarSeed {
	const sparkle = rand() < 0.04
	const drift = base.near ? 1.4 : 0.65
	const sign = () => (rand() < 0.5 ? -1 : 1)

	return {
		cx: base.cx,
		cy: base.cy,
		r: base.r,
		opacity: 0.18 + rand() * 0.55,
		z: base.z,
		delay: -(rand() * 36),
		duration: 22 + rand() * 20,
		twinkleDelay: -(rand() * 16),
		twinkleDuration: 7 + rand() * 11,
		floatX: `${sign() * (5 + rand() * 9) * drift}px`,
		floatY: `${sign() * (7 + rand() * 12) * drift}px`,
		floatZ: `${(18 + rand() * 32) * drift}px`,
		sparkle: sparkle || undefined,
		tint: TINTS[Math.floor(rand() * TINTS.length)],
	}
}

function edgeX(rand: () => number): number {
	const alongEdge = Math.pow(rand(), 0.55) * 26
	return rand() < 0.5 ? alongEdge : 100 - alongEdge
}

function buildSeeds(): CardStarSeed[] {
	const rand = mulberry32(0xa57e91)
	const stars: CardStarSeed[] = []

	for (let i = 0; i < 170; i++) {
		const near = rand() < 0.16
		const inCenter = rand() < 0.1
		stars.push(
			makeStar(rand, {
				cx: inCenter ? 30 + rand() * 40 : edgeX(rand),
				cy: rand() * 100,
				r: near ? 0.14 + rand() * 0.1 : 0.04 + rand() * 0.07,
				z: near ? -40 + rand() * 80 : -280 + rand() * 240,
				near,
			}),
		)
	}

	return stars
}

export const CARD_STAR_SEEDS = buildSeeds()
