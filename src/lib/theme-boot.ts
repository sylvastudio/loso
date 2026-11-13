// Shared by the server layout (inline <head> script) and the client hook.
// No "use client" here: layout.tsx needs the plain string.

export const THEME_KEY = "loso-theme";

/** Runs inline in <head> before first paint, so there's no flash of the wrong theme. */
export const THEME_BOOT_SCRIPT = `(function(){var t="system";try{var s=localStorage.getItem("${THEME_KEY}");if(s==="light"||s==="dark")t=s}catch(e){}document.documentElement.setAttribute("data-theme",t)})()`;
