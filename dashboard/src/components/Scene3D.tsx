import { Canvas } from "@react-three/fiber"
import { Float, MeshDistortMaterial, Sparkles } from "@react-three/drei"
import { Suspense } from "react"

function Blob({
  position,
  color,
  scale,
  speed,
}: {
  position: [number, number, number]
  color: string
  scale: number
  speed: number
}) {
  return (
    <Float speed={speed} rotationIntensity={0.6} floatIntensity={1.2}>
      <mesh position={position} scale={scale}>
        <icosahedronGeometry args={[1, 4]} />
        <MeshDistortMaterial color={color} distort={0.4} speed={1.5} roughness={0.15} metalness={0.4} />
      </mesh>
    </Float>
  )
}

export function Scene3D() {
  return (
    <Canvas
      camera={{ position: [0, 0, 6], fov: 45 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <ambientLight intensity={0.7} />
      <pointLight position={[5, 5, 5]} intensity={1.4} color="#7c5cff" />
      <pointLight position={[-5, -3, -4]} intensity={1} color="#22d3ee" />
      <Suspense fallback={null}>
        <Blob position={[-1.9, 0.7, 0]} color="#7c5cff" scale={1.5} speed={1.1} />
        <Blob position={[2.1, -0.9, -2.5]} color="#22d3ee" scale={1.9} speed={0.75} />
        <Blob position={[0.6, 1.8, -3.5]} color="#d946ef" scale={1} speed={1.5} />
        <Sparkles count={70} scale={9} size={2.2} speed={0.3} color="#a855f7" />
      </Suspense>
    </Canvas>
  )
}
