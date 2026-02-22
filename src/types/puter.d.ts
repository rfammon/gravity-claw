declare module "@heyputer/puter.js/src/init.cjs" {
    export function init(token?: string): any;
    export function getAuthToken(): Promise<string>;
}

declare module "@heyputer/puter.js" {
    const puter: any;
    export default puter;
}
