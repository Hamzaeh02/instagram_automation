import { motion, useMotionTemplate, useMotionValue, useSpring } from "framer-motion"
import clsx from "clsx"
import type { MouseEvent, ReactNode } from "react"

/** A glass card with a real 3D tilt that tracks the cursor, plus a soft
 * light-follow highlight - the CSS-only "3D" treatment used across the
 * dashboard (the full WebGL scene is reserved for auth/marketing pages). */
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
  const mouseX = useMotionValue(50)
  const mouseY = useMotionValue(50)
  const highlight = useMotionTemplate`radial-gradient(320px circle at ${mouseX}% ${mouseY}%, rgba(255,255,255,0.08), transparent 70%)`

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    rotateY.set((px - 0.5) * intensity)
    rotateX.set((0.5 - py) * intensity)
    mouseX.set(px * 100)
    mouseY.set(py * 100)
  }

  function handleMouseLeave() {
    rotateX.set(0)
    rotateY.set(0)
  }

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      className={clsx("glass-card relative overflow-hidden p-6", className)}
    >
      <motion.div className="pointer-events-none absolute inset-0" style={{ background: highlight }} />
      <div className="relative" style={{ transform: "translateZ(24px)" }}>
        {children}
      </div>
    </motion.div>
  )
}
