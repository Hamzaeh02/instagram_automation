import { motion, useMotionTemplate, useMotionValue, useSpring } from "framer-motion"
import clsx from "clsx"
import type { MouseEvent, ReactNode } from "react"

/** A flat, hard-bordered card with a real 3D tilt that tracks the cursor: the
 * offset drop-shadow slides opposite the tilt, so the card reads as a solid
 * plate lifting off the page rather than a glossy glass pane. */
export function TiltCard({
  children,
  className,
  intensity = 10,
}: {
  children: ReactNode
  className?: string
  intensity?: number
}) {
  const rotateX = useSpring(useMotionValue(0), { stiffness: 300, damping: 25 })
  const rotateY = useSpring(useMotionValue(0), { stiffness: 300, damping: 25 })
  const shadowX = useSpring(useMotionValue(6), { stiffness: 300, damping: 25 })
  const shadowY = useSpring(useMotionValue(6), { stiffness: 300, damping: 25 })
  const boxShadow = useMotionTemplate`${shadowX}px ${shadowY}px 0 0 var(--color-border-strong)`

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    rotateY.set((px - 0.5) * intensity)
    rotateX.set((0.5 - py) * intensity)
    shadowX.set((0.5 - px) * 18)
    shadowY.set((0.5 - py) * -18 + 10)
  }

  function handleMouseLeave() {
    rotateX.set(0)
    rotateY.set(0)
    shadowX.set(6)
    shadowY.set(6)
  }

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ rotateX, rotateY, transformPerspective: 900, boxShadow }}
      className={clsx(
        "relative overflow-hidden rounded-[0.625rem] border-2 border-[var(--color-border-strong)] bg-[var(--color-surface)] p-6",
        className,
      )}
    >
      <div className="relative" style={{ transform: "translateZ(24px)" }}>
        {children}
      </div>
    </motion.div>
  )
}
