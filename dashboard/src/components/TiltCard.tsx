import { motion, useMotionValue, useSpring } from "framer-motion"
import clsx from "clsx"
import type { MouseEvent, ReactNode } from "react"

/** A card with a subtle 3D tilt that tracks the cursor, lifting slightly on
 * hover with a soft shadow - a light touch rather than a showy effect. */
export function TiltCard({
  children,
  className,
  intensity = 6,
}: {
  children: ReactNode
  className?: string
  intensity?: number
}) {
  const rotateX = useSpring(useMotionValue(0), { stiffness: 300, damping: 25 })
  const rotateY = useSpring(useMotionValue(0), { stiffness: 300, damping: 25 })

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    rotateY.set((px - 0.5) * intensity)
    rotateX.set((0.5 - py) * intensity)
  }

  function handleMouseLeave() {
    rotateX.set(0)
    rotateY.set(0)
  }

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      whileHover={{ boxShadow: "var(--shadow-card-hover)" }}
      style={{ rotateX, rotateY, transformPerspective: 900, boxShadow: "var(--shadow-card)" }}
      className={clsx(
        "relative overflow-hidden rounded-[0.625rem] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-6",
        className,
      )}
    >
      <div className="relative" style={{ transform: "translateZ(24px)" }}>
        {children}
      </div>
    </motion.div>
  )
}
