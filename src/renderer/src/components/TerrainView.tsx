import React, { useRef, useMemo, useState } from 'react'
import { Canvas, useLoader } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, Html } from '@react-three/drei'
import * as THREE from 'three'
import { TGALoader } from 'three/addons/loaders/TGALoader.js'
import { LevelObject } from '../services/LevelParser'

interface TerrainViewProps {
    heightMap: Uint16Array | null
    objects?: LevelObject[]
    citadels?: LevelObject[]
    textureUrl?: string | null
    textureIndices?: Uint16Array | null
}


const TexturedTerrainMesh: React.FC<{ heightMap: Uint16Array, textureUrl: string }> = ({ heightMap, textureUrl }) => {
    const texture = useLoader(TGALoader, textureUrl)

    React.useEffect(() => {
        if (texture) {
            texture.center.set(0.5, 0.5)
            texture.rotation = Math.PI
        }
    }, [texture])

    return <TerrainMeshFinal heightMap={heightMap} texture={texture} />
}

// Helper to generate a stable random color from an index
const getColorForIndex = (index: number): THREE.Color => {
    // Basic hash
    const r = ((index * 12345) % 255) / 255
    const g = ((index * 67890) % 255) / 255
    const b = ((index * 54321) % 255) / 255
    return new THREE.Color(r, g, b)
}

// Re-defining TerrainMesh to simply accept texture prop OR indices
const TerrainMeshFinal: React.FC<{ heightMap: Uint16Array, texture?: THREE.Texture | null, textureIndices?: Uint16Array | null }> = ({ heightMap, texture, textureIndices }) => {
    const meshRef = useRef<THREE.Mesh>(null)

    const geometry = useMemo(() => {
        const size = 256
        const geo = new THREE.PlaneGeometry(2560, 2560, size - 1, size - 1)
        const posAttribute = geo.attributes.position

        // Apply multi-pass Gaussian smoothing to reduce extreme terrain variations
        // Using 5x5 kernel with 3 passes for much smoother results
        let currentHeights = new Float32Array(heightMap.length)
        for (let i = 0; i < heightMap.length; i++) {
            currentHeights[i] = heightMap[i]
        }

        const SMOOTH_PASSES = 3
        const KERNEL_RADIUS = 2  // 5x5 kernel

        for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
            const nextHeights = new Float32Array(heightMap.length)
            for (let row = 0; row < size; row++) {
                for (let col = 0; col < size; col++) {
                    let sum = 0
                    let weightSum = 0
                    for (let dr = -KERNEL_RADIUS; dr <= KERNEL_RADIUS; dr++) {
                        for (let dc = -KERNEL_RADIUS; dc <= KERNEL_RADIUS; dc++) {
                            const r = row + dr
                            const c = col + dc
                            if (r >= 0 && r < size && c >= 0 && c < size) {
                                // Gaussian-like weight: closer = more weight
                                const dist = Math.sqrt(dr * dr + dc * dc)
                                const weight = Math.exp(-dist * dist / 4)
                                sum += currentHeights[r * size + c] * weight
                                weightSum += weight
                            }
                        }
                    }
                    nextHeights[row * size + col] = sum / weightSum
                }
            }
            currentHeights = nextHeights
        }
        const smoothedHeights = currentHeights

        // Debug: Log heightMap stats
        console.log('[TerrainMesh] heightMap min:', Math.min(...heightMap), 'max:', Math.max(...heightMap))
        console.log('[TerrainMesh] Position count:', posAttribute.count, 'heightMap length:', heightMap.length)

        // Prepare Colors
        const colors: number[] = []

        // PlaneGeometry vertices are laid out in row-major order (size x size)
        // Direct 1:1 mapping - vertex i = heightMap[i]
        for (let i = 0; i < posAttribute.count; i++) {
            const heightIdx = i

            // Get SMOOTHED height from preprocessed array
            const rawH = heightIdx >= 0 && heightIdx < smoothedHeights.length ? smoothedHeights[heightIdx] : 0
            // Invert height (255 - h) since data is stored inverted
            const h = 255 - rawH
            // Scale height (0-255 -> reasonable world units)
            posAttribute.setZ(i, h * 1.0)  // Scale: 255 = 255 world units max height

            // Color based on texture indices (terrain type)
            if (textureIndices) {
                const idx = heightIdx < textureIndices.length ? textureIndices[heightIdx] : 0
                const col = getColorForIndex(idx)
                colors.push(col.r, col.g, col.b)
            } else {
                // Fallback: grayscale based on height
                const normalizedH = h / 255
                colors.push(normalizedH, normalizedH, normalizedH)
            }
        }

        console.log('[TerrainMesh] Heights from SLK applied')

        geo.computeVertexNormals()

        // Always set colors (either from texture indices or height fallback)
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

        return geo
    }, [heightMap, textureIndices])

    return (
        <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} receiveShadow castShadow>
            <primitive object={geometry} />
            <meshStandardMaterial
                color={texture ? '#ffffff' : (textureIndices ? '#ffffff' : '#4caf50')}
                vertexColors={!!textureIndices && !texture}
                wireframe={!texture && !textureIndices}
                map={texture || null}
                side={THREE.DoubleSide}
            />
        </mesh>
    )
}

const ObjectMarkers: React.FC<{ objects: LevelObject[], citadels: LevelObject[], heightMap?: Uint16Array | null }> = ({ objects, citadels, heightMap }) => {
    const [hovered, setHovered] = useState<{ idx: number, type: string, fullType: string } | null>(null)

    // Helper to sample terrain height at a given grid position
    const getTerrainHeight = (gridX: number, gridZ: number): number => {
        if (!heightMap) return 50  // Default if no heightmap
        const size = 256
        // Clamp to grid bounds
        const col = Math.max(0, Math.min(size - 1, Math.floor(gridX)))
        const row = Math.max(0, Math.min(size - 1, Math.floor(gridZ)))
        const idx = row * size + col
        const rawH = heightMap[idx] || 0
        // Apply same inversion as terrain mesh (255 - h)
        return (255 - rawH) * 1.0
    }

    return (
        <group>
            {objects.map((obj, i) => {
                let color = "#00ff00" // Default (Slots)
                let scale = [15, 15, 30] as [number, number, number]  // Increased for easier selection
                let shape = 'CYLINDER'

                if (obj.type === 'SLOT') {
                    color = "#00ff00"
                    scale = [15, 15, 30]  // 3x larger
                } else if (obj.type === 'CITADEL_UPGRADE') {
                    color = "#ffff00"
                    scale = [20, 20, 20]  // 2.5x larger
                    shape = 'BOX'
                } else if (obj.type.startsWith('OBJ_')) {
                    color = "#00ffff"
                    scale = [12, 25, 12]  // 3x larger
                    shape = 'CONE'
                }

                // Convert object coords to world position
                // Object coords are in grid units (0-255), world is -1280 to +1280
                // Fix flip by NOT inverting coordinates
                const worldX = (obj.x - 128) * 10
                const worldZ = (obj.z - 128) * 10

                // Sample terrain height at this position
                const terrainY = getTerrainHeight(obj.x, obj.z)
                // Add half the marker height so it sits on top of terrain
                const yPos = terrainY + scale[2] / 2

                // Display name: use modelName if available, otherwise type
                const displayName = obj.modelName || obj.type

                return (
                    <mesh
                        key={`obj-${i}`}
                        position={[worldX, yPos, worldZ]}
                        onPointerOver={(e: any) => { e.stopPropagation(); setHovered({ idx: i, type: 'OBJ', fullType: obj.type }) }}
                        onPointerOut={(e: any) => setHovered(null)}
                    >
                        {shape === 'CYLINDER' && <cylinderGeometry args={[scale[0], scale[1], scale[2]]} />}
                        {shape === 'BOX' && <boxGeometry args={[scale[0], scale[1], scale[2]]} />}
                        {shape === 'CONE' && <cylinderGeometry args={[0, scale[0], scale[1], 8]} />}

                        <meshBasicMaterial
                            color={hovered?.idx === i && hovered.type === 'OBJ' ? "#ffffff" : color}
                            wireframe
                        />
                        {hovered?.idx === i && hovered.type === 'OBJ' && (
                            <Html position={[0, 25, 0]} center>
                                <div style={{ background: 'rgba(0,0,0,0.9)', color: color, padding: '6px 10px', border: `2px solid ${color}`, fontSize: '12px', whiteSpace: 'nowrap', textAlign: 'left', borderRadius: '4px' }}>
                                    <strong>{displayName}</strong><br />
                                    X: {obj.x.toFixed(1)}, Z: {obj.z.toFixed(1)}
                                </div>
                            </Html>
                        )}
                    </mesh>
                )
            })}

            {citadels.map((cit, i) => {
                // Sample terrain height for citadel too
                const citTerrainY = getTerrainHeight(cit.x, cit.z)
                const citWorldX = (cit.x - 128) * 10
                const citWorldZ = (cit.z - 128) * 10

                return (
                    <mesh
                        key={`cit-${i}`}
                        position={[citWorldX, citTerrainY + 20, citWorldZ]}
                        onPointerOver={(e: any) => { e.stopPropagation(); setHovered({ idx: i, type: 'CIT', fullType: 'CITADEL_BASE' }) }}
                        onPointerOut={(e: any) => setHovered(null)}
                    >
                        <boxGeometry args={[40, 40, 40]} />
                        <meshBasicMaterial color={hovered?.idx === i && hovered.type === 'CIT' ? "#ffffff" : "#ff0000"} wireframe />
                        {hovered?.idx === i && hovered.type === 'CIT' && (
                            <Html position={[0, 50, 0]} center>
                                <div style={{ background: 'rgba(50,0,0,0.8)', color: '#f00', padding: '4px', border: '1px solid #f00', fontSize: '10px', whiteSpace: 'nowrap' }}>
                                    CITADEL BASE<br />
                                    X: {cit.x.toFixed(1)} <br />
                                    Z: {cit.z.toFixed(1)}
                                </div>
                            </Html>
                        )}
                    </mesh>
                )
            })}
        </group>
    )
}

// Loader Component
const AsyncTerrainLoader: React.FC<{ heightMap: Uint16Array, textureUrl?: string | null, textureIndices?: Uint16Array | null }> = ({ heightMap, textureUrl, textureIndices }) => {
    if (textureUrl) {
        return <TexturedTerrainMesh heightMap={heightMap} textureUrl={textureUrl} />
    }
    return <TerrainMeshFinal heightMap={heightMap} textureIndices={textureIndices} />
}

export const TerrainView: React.FC<TerrainViewProps> = ({ heightMap, objects = [], citadels = [], textureUrl, textureIndices }) => {
    return (
        <div style={{ width: '100%', height: '100%' }}>
            <Canvas shadows>
                <PerspectiveCamera makeDefault position={[0, 800, 800]} fov={60} far={100000} />
                <OrbitControls maxDistance={20000} />
                <ambientLight intensity={0.8} />
                <directionalLight position={[100, 200, 100]} intensity={1} castShadow />

                <React.Suspense fallback={null}>
                    {heightMap && <AsyncTerrainLoader heightMap={heightMap} textureUrl={textureUrl} textureIndices={textureIndices} />}
                </React.Suspense>

                {(objects.length > 0 || citadels.length > 0) && <ObjectMarkers objects={objects} citadels={citadels} heightMap={heightMap} />}

                <gridHelper args={[3000, 30, 0x2a5a2a, 0x1a2a1a]} />
            </Canvas>
        </div>
    )
}
