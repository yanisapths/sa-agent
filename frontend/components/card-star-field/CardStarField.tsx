import clsx from 'clsx'
import { type CSSProperties } from 'react'

import styles from './cardStarField.module.css'
import { CARD_STAR_SEEDS } from './constants'

type StarStyle = CSSProperties & {
	'--star-size': string
	'--star-opacity': number
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
							left: `${star.cx}%`,
							top: `${star.cy}%`,
							'--star-size': `${star.r * 12}px`,
							'--star-opacity': star.opacity,
							'--star-z': `${star.z}px`,
							'--star-delay': `${star.delay}s`,
							'--star-duration': `${star.duration}s`,
							'--twinkle-delay': `${star.twinkleDelay}s`,
							'--twinkle-duration': `${star.twinkleDuration}s`,
							'--star-color': star.tint ?? '#fff',
							'--float-x': star.floatX,
							'--float-y': star.floatY,
							'--float-z': star.floatZ,
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
