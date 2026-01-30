
export interface LevelData {
    config: Record<string, string>
    cam?: CamData
    slk: {
        terrain: string[]
        objects: LevelObject[]
        citadels: LevelObject[]
    }
    heightMap: Uint16Array | null
    textureIndices: Uint16Array | null
    textureUrl?: string | null
}

export interface CamData {
    ranking?: string
    objective: string
    spyInfo: string
    description: string
}

export interface LevelObject {
    type: string
    x: number
    y: number // usually Z in game world, but Y in our flattened struct
    z: number
    rotation?: number
    modelName?: string  // Human-readable name from model mapping
}

export class LevelParser {

    static parseCAM(content: string): CamData {
        // Fix encoding issues (simple heuristic for smart quotes/invalid chars)
        content = content.replace(/\uFFFD/g, "'")

        const data: CamData = { objective: '', spyInfo: '', description: '' }
        const lines = content.replace(/\r/g, '').split('\n')
        let section = 'NONE'

        for (const line of lines) {
            const trim = line.trim()
            if (trim === 'OBJECTIVE_BEGIN') { section = 'OBJECTIVE'; continue }
            if (trim === 'OBJECTIVE_END') { section = 'NONE'; continue }
            if (trim === 'SPYINFO_BEGIN') { section = 'SPYINFO'; continue }
            if (trim === 'SPYINFO_END') { section = 'NONE'; continue }
            if (trim === 'DESCRIPTION_BEGIN') { section = 'DESCRIPTION'; continue }
            if (trim === 'DESCRIPTION_END') { section = 'NONE'; continue }

            if (trim === 'CAMPAIGN_RANKING') { section = 'RANKING'; continue }

            if (section === 'RANKING' && trim) {
                data.ranking = trim
                section = 'NONE'
            } else if (section === 'OBJECTIVE') {
                // Skip if first line is just a number
                if (data.objective === '' && /^\d+$/.test(trim)) continue
                data.objective += line + '\n'
            } else if (section === 'SPYINFO') {
                if (data.spyInfo === '' && /^\d+$/.test(trim)) continue
                if (trim.startsWith('PI4')) continue
                data.spyInfo += line + '\n'
            } else if (section === 'DESCRIPTION') {
                if (data.description === '' && /^\d+$/.test(trim)) continue
                data.description += line + '\n'
            }
        }

        return data
    }

    static parseLFL(content: string): Record<string, string> {
        const config: Record<string, string> = {}
        const lines = content.split('\n')
        for (const line of lines) {
            if (line.trim().startsWith('#') || !line.includes(':')) continue
            const [key, ...values] = line.split(':')
            config[key.trim()] = values.join(':').trim()
        }
        return config
    }

    static parseSLK(buffer: Uint8Array): { terrain: string[], objects: LevelObject[], citadels: LevelObject[], textureIndices: Uint16Array, heights: Uint16Array } {
        const objects: LevelObject[] = []
        const citadels: LevelObject[] = []
        const textureIndices = new Uint16Array(256 * 256)
        const heights = new Uint16Array(256 * 256)

        // Model ID to name mapping (extracted from header)
        const modelIdToName: Record<number, string> = {}

        // Decode text part until we reach the binary block
        // SLK header can be large if many textures (e.g., Solaris has 1360 textures = ~22KB header)
        const textDecoder = new TextDecoder()
        // Decode enough to cover large texture lists
        const headerText = textDecoder.decode(buffer.slice(0, 50000))
        const lines = headerText.split('\n')

        // Extract model name mappings from header (format: "models\name.sdf ID")
        for (const line of lines) {
            const modelMatch = line.trim().match(/^models[\\\/](.+?)\.sdf\s+(\d+)$/i)
            if (modelMatch) {
                const modelName = modelMatch[1]
                const modelId = parseInt(modelMatch[2])
                modelIdToName[modelId] = modelName
            }
        }
        console.log('[SLK Parser] Found', Object.keys(modelIdToName).length, 'model mappings')

        // Find dimensions and texture count
        // Looks for line like: 256 256 320
        let textureCount = 0
        let textureListStart = -1
        let binaryOffset = -1

        for (let i = 0; i < lines.length; i++) {
            const parts = lines[i].trim().split(/\s+/)
            if (parts.length === 3 && parts[0] === '256' && parts[1] === '256') {
                textureCount = parseInt(parts[2])
                textureListStart = i + 1
                break
            }
        }

        // Identify binary start offset
        if (textureListStart !== -1) {
            const dimString = `256 256 ${textureCount}`
            const dimOffset = headerText.indexOf(dimString)
            if (dimOffset !== -1) {
                let pos = headerText.indexOf('\n', dimOffset) + 1
                // Skip 'textureCount' lines
                for (let i = 0; i < textureCount; i++) {
                    const nextLine = headerText.indexOf('\n', pos)
                    if (nextLine === -1) break
                    pos = nextLine + 1
                }

                binaryOffset = pos

                // Extract 6-byte records. 
                // Bits 0-15 of the first two bytes are the local texture index.
                for (let i = 0; i < 256 * 256; i++) {
                    const recordOffset = binaryOffset + (i * 6)
                    if (recordOffset + 2 <= buffer.length) {
                        textureIndices[i] = buffer[recordOffset] | (buffer[recordOffset + 1] << 8)
                    }
                }

                // Extract heights from Layer 5 using DYNAMICALLY calculated binaryOffset
                // Layer 5 is at binaryOffset + 5*65536, with width 257
                const LAYER5_OFFSET = binaryOffset + (5 * 65536)
                const LAYER5_WIDTH = 257
                console.log('[SLK Parser] Binary header offset:', binaryOffset, 'Layer 5 offset:', LAYER5_OFFSET)

                for (let row = 0; row < 256; row++) {
                    for (let col = 0; col < 256; col++) {
                        const srcIdx = LAYER5_OFFSET + row * LAYER5_WIDTH + col
                        const dstIdx = row * 256 + col
                        if (srcIdx < buffer.length) {
                            heights[dstIdx] = buffer[srcIdx]
                        }
                    }
                }
                console.log('[SLK Parser] Heights extracted, range:', Math.min(...heights), '-', Math.max(...heights))
            }
        }

        // Parse Footer for Objects
        // We calculate where the footer should start: Binary Start + (256*256*6)
        if (binaryOffset !== -1) {
            const footerStart = binaryOffset + (256 * 256 * 6)
            if (footerStart < buffer.length) {
                const footerBuffer = buffer.slice(footerStart)
                const footerText = new TextDecoder().decode(footerBuffer)
                const footerLines = footerText.split('\n')

                let mode = 'NONE'
                let count = 0
                let currentCitadel: { base?: LevelObject, upgrades: LevelObject[] } | null = null

                for (let i = 0; i < footerLines.length; i++) {
                    const line = footerLines[i].trim()
                    if (!line || line.startsWith('#')) continue

                    const parts = line.split(/\s+/)

                    if (mode === 'NONE') {
                        if (line.startsWith('slots ')) {
                            mode = 'SLOTS'
                            count = parseInt(parts[1])
                            continue
                        }
                        if (line.startsWith('citadel ')) {
                            mode = 'CITADEL_BLOCK'
                            currentCitadel = { upgrades: [] }
                            continue
                        }
                        if (line.startsWith('objects ')) {
                            mode = 'OBJECTS'
                            count = parseInt(parts[1])
                            continue
                        }
                    }

                    if (mode === 'SLOTS') {
                        if (parts.length >= 2) {
                            const x = parseFloat(parts[0])
                            const z = parseFloat(parts[1])
                            const rot = parseFloat(parts[2]) || 0
                            if (!isNaN(x)) {
                                objects.push({ type: 'SLOT', x, y: 0, z, rotation: rot })
                                count--
                            }
                        }
                        if (count <= 0) mode = 'NONE'
                        continue
                    }

                    if (mode === 'CITADEL_BLOCK') {
                        if (line.startsWith('base ')) {
                            const x = parseFloat(parts[1])
                            const z = parseFloat(parts[2])
                            const rot = parseFloat(parts[3]) || 0
                            if (currentCitadel) {
                                currentCitadel.base = { type: 'CITADEL_BASE', x, y: 0, z, rotation: rot }
                            }
                            continue
                        }
                        if (line.startsWith('upgrades ')) {
                            mode = 'CITADEL_UPGRADES'
                            count = parseInt(parts[1])
                            continue
                        }
                        // Handle start of next citadel implicitly if we see 'citadel ' again or 'claim'
                        if (line.startsWith('citadel ')) {
                            // Finish previous
                            if (currentCitadel && currentCitadel.base) {
                                citadels.push(currentCitadel.base)
                                objects.push(...currentCitadel.upgrades)
                            }
                            currentCitadel = { upgrades: [] }
                            // stay in CITADEL_BLOCK
                            continue
                        }
                        // If we hit 'objects' or other main blocks, flush and switch
                        if (line.startsWith('objects ')) {
                            if (currentCitadel && currentCitadel.base) {
                                citadels.push(currentCitadel.base)
                                objects.push(...currentCitadel.upgrades)
                            }
                            mode = 'OBJECTS'
                            count = parseInt(parts[1])
                            continue
                        }
                    }

                    if (mode === 'CITADEL_UPGRADES') {
                        // Upgrade lines: X Z Rot Type/Unk
                        if (parts.length >= 3) {
                            const x = parseFloat(parts[0])
                            const z = parseFloat(parts[1])
                            const rot = parseFloat(parts[2]) || 0
                            if (currentCitadel && !isNaN(x)) {
                                currentCitadel.upgrades.push({ type: 'CITADEL_UPGRADE', x, y: 0, z, rotation: rot })
                                count--
                            }
                        }
                        if (count <= 0) {
                            mode = 'CITADEL_BLOCK' // Go back to check for next citadel or end
                        }
                        continue
                    }

                    if (mode === 'OBJECTS') {
                        // Line: ID Unk X Z Y Rot
                        // 33 8 125.99 ...
                        if (parts.length >= 6) {
                            const id = parseInt(parts[0])
                            const x = parseFloat(parts[2])
                            const z = parseFloat(parts[3])
                            const y = parseFloat(parts[4])
                            const rot = parseFloat(parts[5]) || 0
                            // Get model name from mapping, fallback to ID
                            const modelName = modelIdToName[id] || `Unknown_${id}`
                            if (!isNaN(x)) {
                                objects.push({ type: `OBJ_${id}`, x, y, z, rotation: rot, modelName })
                                count--
                            }
                        }
                        if (count <= 0) mode = 'NONE'
                        continue
                    }
                }
                // End loop cleanup
                if (currentCitadel && currentCitadel.base) {
                    citadels.push(currentCitadel.base)
                    objects.push(...currentCitadel.upgrades)
                }
            }
        }

        return { terrain: [], objects, citadels, textureIndices, heights }
    }

    static parseDPH(buffer: Uint8Array): { heights: Uint16Array } {
        const count = 256 * 256
        const heights = new Uint16Array(count)

        // DPH is exactly 128KB of Little Endian 16-bit heights
        for (let i = 0; i < count; i++) {
            const offset = i * 2
            if (offset + 1 < buffer.length) {
                heights[i] = buffer[offset] | (buffer[offset + 1] << 8)
            }
        }

        return { heights }
    }
}
