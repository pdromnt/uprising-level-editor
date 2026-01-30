import { useState, JSX } from 'react'
import { LevelParser, LevelData } from './services/LevelParser'
import { TerrainView } from './components/TerrainView'
import { ScriptEditor } from './components/ScriptEditor'

function App(): JSX.Element {
    const [rootPath, setRootPath] = useState<string | null>(null)
    const [levels, setLevels] = useState<string[]>([])
    const [selectedLevel, setSelectedLevel] = useState<string | null>(null)

    // Helper to keep track of file paths for saving
    const [currentFiles, setCurrentFiles] = useState<{ lfl?: string, slk?: string, hzs?: string }>({})

    // View Mode: 'TACTICAL' | 'COMMS'
    const [viewMode, setViewMode] = useState<'TACTICAL' | 'COMMS'>('TACTICAL')

    // Parsed Level Data
    const [levelData, setLevelData] = useState<LevelData | null>(null)

    // Script Data
    const [scriptContent, setScriptContent] = useState<string>('')

    const [status, setStatus] = useState<string>('SYSTEM READY')

    const handleOpenFolder = async () => {
        setStatus('ACCESSING FILE SYSTEM...')
        const path = await window.api.openDirectory()
        if (path) {
            setRootPath(path)
            setStatus(`ROOT: ${path.toUpperCase()}`)
            loadLevels(path)
        } else {
            setStatus('SELECTION ABORTED')
        }
    }

    const loadLevels = async (path: string) => {
        setStatus('SCANNING SECTOR...')
        try {
            const files = await window.api.listLevels(path)
            setLevels(files)
            setStatus(`FOUND ${files.length} SECTORS`)
        } catch (e) {
            setStatus('SCAN FAILURE')
            console.error(e)
        }
    }

    const handleLevelSelect = async (filename: string) => {
        setSelectedLevel(filename)
        if (!rootPath) return

        // Reset View
        setViewMode('TACTICAL')
        setScriptContent('')
        setCurrentFiles({})

        setStatus(`DECRYPTING ${filename.toUpperCase()}...`)

        try {
            // 1. Read LFL
            const lflPath = `${rootPath}\\GRIDS\\${filename}`
            const lflContent = await window.api.readFile(lflPath)
            const config = LevelParser.parseLFL(lflContent)

            // 2. Identify Linked Files
            // Find SLK filename
            let slkFileName = ''
            let hzsFileName = ''
            let camFileName = ''

            Object.keys(config).forEach(k => {
                if (k.toUpperCase() === 'SLK_FILE') slkFileName = config[k]
                if (k.toUpperCase() === 'SCRIPT_FILE') hzsFileName = config[k]
                if (k.toUpperCase() === 'MAP_TEXT') camFileName = config[k]
            })

            // Fallback for HZS if not strictly in config (often same name as level)
            if (!hzsFileName) {
                hzsFileName = filename.replace(/\.lfl$/i, '.hzs')
            }

            // Load CAM
            let camData = undefined
            if (camFileName) {
                const camPath = `${rootPath}\\GRIDS\\${camFileName}`
                try {
                    const camContent = await window.api.readFile(camPath)
                    camData = LevelParser.parseCAM(camContent)
                } catch (e) {
                    console.warn("Failed to read CAM", e)
                }
            }

            // Load SLK
            let slkData: any = { terrain: [], objects: [], citadels: [], textureIndices: new Uint16Array(0) }
            if (slkFileName) {
                const slkPath = `${rootPath}\\GRIDS\\${slkFileName}`
                try {
                    const slkBuffer = await window.api.readBinary(slkPath)
                    slkData = LevelParser.parseSLK(slkBuffer)
                } catch (e) {
                    console.warn("Failed to read SLK", e)
                }
            }

            // Load HZS (Script)
            let loadedScript = ''
            const hzsPath = `${rootPath}\\GRIDS\\${hzsFileName}`
            try {
                loadedScript = await window.api.readFile(hzsPath)
            } catch (e) {
                console.warn("Failed to read HZS", e)
                loadedScript = "// NO COMM LINK ESTABLISHED (FILE NOT FOUND)"
            }
            setScriptContent(loadedScript)

            // 3. Find DPH (Terrain)
            const baseName = filename.replace(/\.lfl$/i, '')
            const dphPath = `${rootPath}\\GRIDS\\depths\\${baseName}.dph`

            let dphResult: { heights: Uint16Array | null, dphTextureIndices?: Uint16Array | null } = { heights: null }
            try {
                const buffer = await window.api.readBinary(dphPath)
                // @ts-ignore
                dphResult = LevelParser.parseDPH(buffer)
            } catch (e) {
                // Try uppercase
                try {
                    const dphPathUpper = `${rootPath}\\GRIDS\\depths\\${baseName.toUpperCase()}.dph`
                    const buffer = await window.api.readBinary(dphPathUpper)
                    // @ts-ignore
                    dphResult = LevelParser.parseDPH(buffer)
                } catch (e2) {
                    console.error("Failed to read DPH", e2)
                }
            }

            // 4. Load Minimap (TGA) as Texture
            // Try standard naming: GRIDS/gohs/Name.tga
            let textureUrl = null
            const tgaPath = `${rootPath}\\GRIDS\\gohs\\${baseName}.tga`
            try {
                const tgaBuffer = await window.api.readBinary(tgaPath)
                const blob = new Blob([tgaBuffer], { type: 'image/tga' })
                textureUrl = URL.createObjectURL(blob)
            } catch (e) {
                console.warn("Failed to read TGA", e)
                // Try uppercase
                try {
                    const tgaPathUpper = `${rootPath}\\GRIDS\\gohs\\${baseName.toUpperCase()}.tga`
                    const tgaBuffer = await window.api.readBinary(tgaPathUpper)
                    const blob = new Blob([tgaBuffer], { type: 'image/tga' })
                    textureUrl = URL.createObjectURL(blob)
                } catch (e2) {
                    console.warn("Failed to read TGA (upper)", e2)
                }
            }

            // Store paths for saving
            setCurrentFiles({
                lfl: lflPath,
                slk: slkFileName ? `${rootPath}\\GRIDS\\${slkFileName}` : undefined,
                hzs: hzsPath
            })

            // Use heights from SLK (Layer 5) instead of DPH
            // SLK Layer 5 at width 257 contains the correct heightmap
            setLevelData({
                config,
                cam: camData,
                slk: slkData,
                heightMap: slkData.heights || null,  // Use SLK heights instead of DPH
                textureIndices: slkData.textureIndices || null,
                textureUrl
            })

            setStatus(`TACTICAL DISPLAY ACTIVE: ${baseName.toUpperCase()}`)

        } catch (e) {
            setStatus('DECRYPTION FAILURE')
            console.error(e)
        }
    }

    const handleSaveScript = async () => {
        if (!currentFiles.hzs) return
        setStatus('TRANSMITTING UPDATE...')
        try {
            await window.api.writeFile(currentFiles.hzs, scriptContent)
            setStatus('TRANSMISSION COMPLETE')
        } catch (e) {
            setStatus('TRANSMISSION FAILURE')
            console.error(e)
        }
    }

    return (
        <div className="hotzone-app">
            <header className="hud-header">
                <div className="logo">
                    <h1>HOTZONE</h1>
                    <span className="version">v0.0.1 // CLASSIFIED</span>
                </div>

                {/* View Toggles */}
                <div className="view-toggles" style={{ display: 'flex', gap: '10px', marginLeft: '20px' }}>
                    <div
                        className={`clickable ${viewMode === 'TACTICAL' ? 'active-mode' : ''}`}
                        onClick={() => setViewMode('TACTICAL')}
                        style={{ color: viewMode === 'TACTICAL' ? '#00ff00' : '#444', cursor: 'pointer', borderBottom: viewMode === 'TACTICAL' ? '2px solid #00ff00' : 'none' }}
                    >
                        [TACTICAL]
                    </div>
                    <div
                        className={`clickable ${viewMode === 'COMMS' ? 'active-mode' : ''}`}
                        onClick={() => setViewMode('COMMS')}
                        style={{ color: viewMode === 'COMMS' ? '#00ff00' : '#444', cursor: 'pointer', borderBottom: viewMode === 'COMMS' ? '2px solid #00ff00' : 'none' }}
                    >
                        [COMMS/SCRIPT]
                    </div>
                </div>

                <div className="status-bar" style={{ marginLeft: 'auto', marginRight: '20px', marginBottom: '5px' }}>
                    <span className="scramble-text clickable" onClick={handleOpenFolder} style={{ cursor: 'pointer', fontFamily: 'monospace' }}>
                        [LOCATION: {rootPath ? rootPath : 'MOUNT DRIVE'}]
                    </span>
                </div>
                <div className="status-message" style={{ fontFamily: 'monospace', color: 'var(--color-alert)' }}>
                    [{status}]
                </div>
            </header>

            <main className="hud-main">
                <aside className="hud-sidebar">
                    <div className="panel-header" onClick={handleOpenFolder} style={{ cursor: 'pointer' }}>
                        MISSION CONTROL [LOAD]
                    </div>
                    <div className="file-list">
                        {levels.length === 0 ? (
                            <div className="list-item">NO DATA</div>
                        ) : (
                            levels.map(lvl => (
                                <div
                                    key={lvl}
                                    className={`list-item ${selectedLevel === lvl ? 'active' : ''}`}
                                    onClick={() => handleLevelSelect(lvl)}
                                >
                                    {lvl.replace('.lfl', '').replace('.LFL', '')}
                                </div>
                            ))
                        )}
                    </div>
                </aside>

                <section className="hud-viewport">
                    {viewMode === 'TACTICAL' ? (
                        <>
                            <div className="viewport-overlay" style={{ pointerEvents: 'none' }}></div>
                            <TerrainView
                                heightMap={levelData?.heightMap || null}
                                objects={levelData?.slk?.objects}
                                citadels={levelData?.slk?.citadels}
                                textureUrl={levelData?.textureUrl}
                                textureIndices={levelData?.textureIndices}
                            />
                        </>
                    ) : (
                        <ScriptEditor
                            content={scriptContent}
                            onChange={setScriptContent}
                            onSave={handleSaveScript}
                            fileName={currentFiles.hzs ? currentFiles.hzs.split('\\').pop() || 'UNKNOWN' : null}
                        />
                    )}
                </section>

                <aside className="hud-properties">
                    <div className="panel-header">INTEL</div>
                    <div className="prop-grid" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
                        <div className="intel-section">
                            <div className="prop-grid-kv" style={{ display: 'grid', gridTemplateColumns: 'min-content 1fr', gap: '4px 12px' }}>
                                <span className="prop-label" style={{ textAlign: 'right', color: '#888' }}>REGION</span>
                                <span className="prop-value">{selectedLevel || 'N/A'}</span>
                                <span className="prop-label" style={{ textAlign: 'right', color: '#888' }}>MODE</span>
                                <span className="prop-value">{viewMode}</span>
                            </div>
                        </div>

                        {levelData?.cam && (
                            <>
                                {levelData.cam.description && (
                                    <div className="intel-section">
                                        <div className="prop-label" style={{ color: '#aaa', marginBottom: '2px' }}>DESCRIPTION</div>
                                        <div className="prop-value" style={{ fontSize: '0.8em', whiteSpace: 'pre-wrap', color: '#ccc' }}>
                                            {levelData.cam.description.trim()}
                                        </div>
                                    </div>
                                )}
                                <div className="intel-section">
                                    <div className="prop-label" style={{ color: '#aaa', marginBottom: '2px' }}>OBJECTIVE</div>
                                    <div className="prop-value" style={{ fontSize: '0.8em', whiteSpace: 'pre-wrap', color: '#ccc' }}>
                                        {levelData.cam.objective.trim() || 'No Objective Data'}
                                    </div>
                                </div>
                                {levelData.cam.spyInfo && (
                                    <div className="intel-section">
                                        <div className="prop-label" style={{ color: '#aaa', marginBottom: '2px' }}>SPY INFO</div>
                                        <div className="prop-value" style={{ fontSize: '0.8em', whiteSpace: 'pre-wrap', color: '#e6db74' }}>
                                            {levelData.cam.spyInfo.trim()}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {levelData && (
                            <div className="intel-section">
                                <div className="prop-label" style={{ color: '#aaa', marginBottom: '4px' }}>ENVIRONMENT</div>
                                <div className="prop-grid-kv" style={{ display: 'grid', gridTemplateColumns: 'min-content 1fr', gap: '4px 12px' }}>
                                    <span style={{ fontSize: '0.7em', color: '#666', textAlign: 'right' }}>SKY:</span>
                                    <span style={{ fontSize: '0.7em' }}>{levelData.config['POLY_SKY'] || 'DEFAULT'}</span>
                                    <span style={{ fontSize: '0.7em', color: '#666', textAlign: 'right' }}>FOG:</span>
                                    <span style={{ fontSize: '0.7em' }}>{levelData.config['FOG_COLOR'] || '0'}</span>
                                    <span style={{ fontSize: '0.7em', color: '#666', textAlign: 'right' }}>NBH:</span>
                                    <span style={{ fontSize: '0.7em' }}>{levelData.config['NEIGHBOR_FILE'] || 'NONE'}</span>
                                </div>
                            </div>
                        )}

                        {levelData && (
                            <div className="intel-section">
                                <div className="prop-label" style={{ color: '#aaa', marginBottom: '4px' }}>RATES & CONFIG</div>
                                {Object.entries(levelData.config).map(([k, v]) => {
                                    // Filter for interesting keys only
                                    const isInteresting = k.includes('RATE') || k.includes('LIFESPAN') || k.includes('POWERUP') || k.includes('DEFENSE')
                                    if (!isInteresting) return null
                                    return (
                                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7em', borderBottom: '1px solid #111' }}>
                                            <span style={{ color: '#666' }}>{k}:</span>
                                            <span style={{ color: '#bbb' }}>{v}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </aside>
            </main>
        </div>
    )
}

export default App
