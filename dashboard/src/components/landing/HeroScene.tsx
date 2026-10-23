import { Float, Html, MeshDistortMaterial, Sparkles } from "@react-three/drei"
import { Canvas, useFrame } from "@react-three/fiber"
import { Suspense, useRef } from "react"
import type { Group, Mesh } from "three"
import { BRAND_PLATFORMS } from "../BrandLogos"

const ORBIT_RADIUS = 2.15

function Core() {
  const ring1 = useRef<Mesh>(null)
  const ring2 = useRef<Mesh>(null)
  useFrame((_, d) => {
    if (ring1.current) ring1.current.rotation.z += d * 0.35
    if (ring2.current) ring2.current.rotation.z -= d * 0.25
  })
  return (
    <Float speed={1.6} rotationIntensity={0.4} floatIntensity={0.9}>
      <mesh scale={1.15}>
        <icosahedronGeometry args={[1, 32]} />
        <MeshDistortMaterial color="#6a8f2e" emissive="#2f4a10" emissiveIntensity={0.35} roughness={0.18} metalness={0.25} distort={0.38} speed={1.8} />
      </mesh>
      {/* play-button glyph floating on the core's face */}
      <mesh position={[0.08, 0, 1.25]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.32, 0.5, 3]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.6} roughness={0.3} />
      </mesh>
      <mesh ref={ring1} rotation={[1.2, 0.3, 0]}>
        <torusGeometry args={[1.75, 0.025, 16, 140]} />
        <meshStandardMaterial color="#b5701f" emissive="#b5701f" emissiveIntensity={0.5} />
      </mesh>
      <mesh ref={ring2} rotation={[1.9, -0.5, 0.4]}>
        <torusGeometry args={[2.05, 0.015, 16, 140]} />
        <meshStandardMaterial color="#2f7680" emissive="#2f7680" emissiveIntensity={0.5} />
      </mesh>
    </Float>
  )
}

function OrbitingLogos() {
  const group = useRef<Group>(null)
  useFrame((_, d) => {
    if (group.current) group.current.rotation.y += d * 0.22
  })
  return (
    <group rotation={[0.32, 0, 0.08]}>
      <group ref={group}>
        {BRAND_PLATFORMS.map((p, i) => {
          const angle = (i / BRAND_PLATFORMS.length) * Math.PI * 2
          return (
            <group key={p.key} position={[Math.cos(angle) * ORBIT_RADIUS, Math.sin(angle * 2) * 0.35, Math.sin(angle) * ORBIT_RADIUS]}>
              <Html center distanceFactor={7} zIndexRange={[20, 0]}>
                <div className="flex select-none items-center gap-2 rounded-2xl border border-white/70 bg-white/85 px-3 py-2 shadow-[0_10px_30px_-10px_rgba(28,26,20,0.35)] backdrop-blur-md">
                  <span className="flex h-8 w-9 items-center justify-center">
                    <p.logo className={p.key === "youtube" ? "h-6 w-8" : "h-8 w-8"} />
                  </span>
                  <span className="whitespace-nowrap pr-1 text-sm font-bold text-[#211f1a]">{p.label}</span>
                </div>
              </Html>
            </group>
          )
        })}
      </group>
    </group>
  )
}

function Rig() {
  // Gentle parallax: the camera drifts toward the pointer.
  useFrame((state) => {
    state.camera.position.x += (state.pointer.x * 0.9 - state.camera.position.x) * 0.04
    state.camera.position.y += (state.pointer.y * 0.6 + 0.4 - state.camera.position.y) * 0.04
    state.camera.lookAt(0, 0, 0)
  })
  return null
}

export function HeroScene() {
  return (
    <Canvas camera={{ position: [0, 0.4, 8], fov: 45 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.9} />
      <directionalLight position={[4, 5, 5]} intensity={1.6} />
      <pointLight position={[-4, -2, 3]} intensity={18} color="#d9a441" />
      <pointLight position={[3, 2, -3]} intensity={14} color="#2f7680" />
      <Suspense fallback={null}>
        <Core />
        <OrbitingLogos />
        <Sparkles count={60} scale={[8, 5, 4]} size={2.4} speed={0.35} color="#6a8f2e" opacity={0.7} />
      </Suspense>
      <Rig />
    </Canvas>
  )
}
