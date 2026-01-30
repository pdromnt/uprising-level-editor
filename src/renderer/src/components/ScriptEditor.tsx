import React, { useState, useEffect } from 'react'

interface ScriptEditorProps {
    content: string
    onChange: (newContent: string) => void
    onSave: () => void
    fileName: string | null
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({ content, onChange, onSave, fileName }) => {

    // Auto-resize textarea logic could go here, but simple flex is safer for now.

    return (
        <div className="script-editor-container" style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
            backgroundColor: '#0a0a0a',
            border: '1px solid var(--color-primary)',
            padding: '4px'
        }}>
            <div className="editor-toolbar" style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '5px',
                borderBottom: '1px solid var(--color-primary-dim)',
                marginBottom: '5px',
                backgroundColor: 'rgba(0, 20, 0, 0.5)'
            }}>
                <span className="file-info" style={{ fontFamily: 'monospace', color: 'var(--color-primary)' }}>
                    FILE: {fileName || 'NO CONNECTION'}
                </span>
                <button
                    onClick={onSave}
                    className="save-btn"
                    disabled={!fileName}
                    style={{
                        background: 'var(--color-primary-dim)',
                        border: '1px solid var(--color-primary)',
                        color: 'var(--color-text)',
                        fontFamily: 'monospace',
                        cursor: 'pointer',
                        padding: '2px 10px'
                    }}
                >
                    [TRANSMIT UPDATE]
                </button>
            </div>
            <textarea
                value={content}
                onChange={(e) => onChange(e.target.value)}
                style={{
                    flex: 1,
                    backgroundColor: 'transparent',
                    color: '#00ff00',
                    fontFamily: 'Consolas, monospace',
                    fontSize: '14px',
                    border: 'none',
                    resize: 'none',
                    outline: 'none',
                    lineHeight: '1.4',
                    padding: '10px'
                }}
                spellCheck={false}
            />
        </div>
    )
}
