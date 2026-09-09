import clsx from 'clsx'
import { type CSSProperties } from 'react'

import styles from './cardStarField.module.css'
import { CARD_STAR_SEEDS } from './constants'

function cssNumber(value: number) {
	return value.toFixed(4)
}

function cssUnit(value: number, unit: string) {
	return `${cssNumber(value)}${unit}`
}

type StarStyle = CSSProperties & {
	'--star-x': string
	'--star-y': string
	'--star-size': string
	'--star-opacity': string
	'--star-z': string
	'--star-delay': string
	'--star-duration': string
	'--twinkle-delay': string
	'--twinkle-duration': string
	'--star-color': string
	'--float-x': string
	'--float-y': string
	'--float-z': string
}

interface CardStarFieldProps {
	active?: boolean
	still?: boolean
}

export function CardStarField({ still = false }: CardStarFieldProps) {
	return (
		<div className={clsx(styles.scene, 'hidden dark:block', still && styles.still)} aria-hidden>
			<div className={styles.depth} />
			<div className={styles.space}>
				<div className={styles.field}>
					{CARD_STAR_SEEDS.map((star, index) => {
						const style: StarStyle = {
							'--star-x': cssNumber(star.cx),
							'--star-y': cssNumber(star.cy),
							'--star-size': cssUnit(star.r * 12, 'px'),
							'--star-opacity': cssNumber(star.opacity),
							'--star-z': cssUnit(star.z, 'px'),
							'--star-delay': cssUnit(star.delay, 's'),
							'--star-duration': cssUnit(star.duration, 's'),
							'--twinkle-delay': cssUnit(star.twinkleDelay, 's'),
							'--twinkle-duration': cssUnit(star.twinkleDuration, 's'),
							'--star-color': star.tint ?? '#fff',
							'--float-x': cssUnit(star.floatX, 'px'),
							'--float-y': cssUnit(star.floatY, 'px'),
							'--float-z': cssUnit(star.floatZ, 'px'),
						}

						return (
							<span
								key={index}
								className={clsx(styles.star, star.sparkle && styles.sparkle)}
								style={style}
							>
								{star.sparkle ? '✦' : null}
							</span>
						)
					})}
				</div>
			</div>
		</div>
	)
}
