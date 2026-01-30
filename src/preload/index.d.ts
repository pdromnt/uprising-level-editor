export interface IElectronAPI {
    loadPreferences: () => Promise<void>
}

export interface IAPI {
    openDirectory: () => Promise<string | null>
    listLevels: (rootPath: string) => Promise<string[]>
    readFile: (filePath: string) => Promise<string>
    readBinary: (filePath: string) => Promise<Uint8Array>
    writeFile: (filePath: string, content: string) => Promise<boolean>
}

declare global {
    interface Window {
        electron: IElectronAPI
        api: IAPI
    }
}
