import { Canvas, useFrame } from "@react-three/fiber"
import { Grid } from "@react-three/drei"
import { Suspense, useRef } from "react"
import type { Mesh } from "three"

function SpinningShape({
  position,
  color,
  scale,
  speed,
  wireframe,
  geometry,
}: {
  position: [number, number, number]
  color: string
  scale: number
  speed: [number, number]
  wireframe: boolean
  geometry: "icosahedron" | "octahedron" | "torusKnot"
}) {
  const ref = useRef<Mesh>(null)

  useFrame((_, delta) => {
    if (!ref.current) return
    ref.current.rotation.x += delta * speed[0]
    ref.current.rotation.y += delta * speed[1]
  })

  return (
    <mesh ref={ref} position={position} scale={scale}>
      {geometry === "icosahedron" && <icosahedronGeometry args={[1, 0]} />}
      {geometry === "octahedron" && <octahedronGeometry args={[1, 0]} />}
      {geometry === "torusKnot" && <torusKnotGeometry args={[0.7, 0.22, 100, 12]} />}
      <meshStandardMaterial
        color={color}
        wireframe={wireframe}
        flatShading
        roughness={0.9}
        metalness={0}
      />
    </mesh>
  )
}

export function Scene3D() {
  return (
    <Canvas
      camera={{ position: [0, 1.4, 7], fov: 42 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[4, 6, 5]} intensity={1.2} color="#f5f1e6" />
      <Suspense fallback={null}>
        <Grid
          position={[0, -2.4, 0]}
          args={[30, 30]}
          cellSize={0.6}
          cellThickness={0.6}
          cellColor="#4a4530"
          sectionSize={3}
          sectionThickness={1}
          sectionColor="#d7f43a"
          fadeDistance={16}
          infiniteGrid
        />
        <SpinningShape
          position={[-1.9, 0.8, 0]}
          color="#d7f43a"
          scale={1.35}
          speed={[0.15, 0.22]}
          wireframe
          geometry="icosahedron"
        />
        <SpinningShape
          position={[2.1, -0.4, -2.2]}
          color="#ff8a3d"
          scale={1.6}
          speed={[0.1, 0.16]}
          wireframe={false}
          geometry="octahedron"
        />
        <SpinningShape
          position={[0.4, 2.1, -3.5]}
          color="#f5f1e6"
          scale={0.9}
          speed={[0.25, 0.18]}
          wireframe
          geometry="torusKnot"
        />
      </Suspense>
    </Canvas>
  )
}
