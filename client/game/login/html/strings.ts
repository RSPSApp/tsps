import { useCallback, useEffect, useState } from "react";

/**
 * The login screen's words, in the three languages the world serves.
 *
 * Kept here rather than in a dictionary shared with the game because only this screen is
 * translated so far: the Idle screen inside the game is still English, and moving its strings
 * across is its own piece of work. When that happens this is what it should join.
 */
export type Lang = "pt" | "en" | "es";

type Tile = { value: string; label: string };
type Strings = {
    language: string;
    worldLine: string;
    eyebrow: string;
    h1: string;
    h2: string;
    h3: string;
    h4: string;
    tiles: Tile[];
    kicker: string;
    title: string;
    greet: string;
    user: string;
    pass: string;
    remember: string;
    go: string;
    connecting: string;
    help: string;
    /** The loading screen, which shares this screen's art and its language switch. */
    loadCache: string;
    loadWorld: string;
    loadFirst: string;
    tips: string[];
};

/**
 * The numbers are the world's own, from server/plugins/modes/data/idle-mode.json: a 12 hour
 * offline cap and 35 travel sites. A screen that promises less than the game pays teaches the
 * player on their first minute that the screen lies.
 */
export const STRINGS: Record<Lang, Strings> = {
    pt: {
        language: "Idioma",
        worldLine: "MUNDO AUTORITATIVO",
        eyebrow: "UM MUNDO CLÁSSICO. NO SEU RITMO.",
        h1: "TREINE.", h2: "LUTE.", h3: "CONTINUE", h4: "EVOLUINDO.",
        tiles: [
            { value: "12h", label: "progresso offline" },
            { value: "35", label: "atividades no mapa" },
            { value: "1", label: "mundo persistente" },
        ],
        kicker: "SUA AVENTURA ESPERA",
        title: "VOLTE AO JOGO",
        greet: "Entre e continue exatamente de onde parou.",
        user: "USUÁRIO",
        pass: "SENHA",
        remember: "Lembrar meu usuário",
        go: "ENTRAR",
        connecting: "CONECTANDO…",
        help: "Usuário de 3 a 20 caracteres. Senha com 8 no mínimo.",
        loadCache: "BAIXANDO O MUNDO",
        loadWorld: "ENTRANDO NO MUNDO",
        loadFirst: "A primeira vez demora mais: depois fica no seu navegador.",
        tips: [
            "O personagem continua trabalhando com o navegador fechado, até 12 horas.",
            "XP, dano e loot são calculados no servidor — nada depende da sua máquina.",
            "Escolha a atividade na aba Idle e pode fechar o jogo.",
            "São 35 lugares no mapa para treinar. Troque quando quiser.",
        ],
    },
    en: {
        language: "Language",
        worldLine: "AUTHORITATIVE WORLD",
        eyebrow: "A CLASSIC WORLD. AT YOUR OWN PACE.",
        h1: "TRAIN.", h2: "FIGHT.", h3: "KEEP", h4: "GROWING.",
        tiles: [
            { value: "12h", label: "offline progress" },
            { value: "35", label: "activities on the map" },
            { value: "1", label: "persistent world" },
        ],
        kicker: "YOUR ADVENTURE AWAITS",
        title: "WELCOME BACK",
        greet: "Sign in and pick up exactly where you left off.",
        user: "USERNAME",
        pass: "PASSWORD",
        remember: "Remember my username",
        go: "SIGN IN",
        connecting: "CONNECTING…",
        help: "Username 3 to 20 characters. Password at least 8.",
        loadCache: "DOWNLOADING THE WORLD",
        loadWorld: "ENTERING THE WORLD",
        loadFirst: "The first time takes longer; after that it stays in your browser.",
        tips: [
            "Your character keeps working with the browser closed, up to 12 hours.",
            "XP, damage and loot are worked out on the server — none of it needs your machine.",
            "Pick an activity on the Idle tab and you can close the game.",
            "There are 35 places on the map to train. Move whenever you like.",
        ],
    },
    es: {
        language: "Idioma",
        worldLine: "MUNDO AUTORITATIVO",
        eyebrow: "UN MUNDO CLÁSICO. A TU RITMO.",
        h1: "ENTRENA.", h2: "LUCHA.", h3: "SIGUE", h4: "CRECIENDO.",
        tiles: [
            { value: "12h", label: "progreso sin conexión" },
            { value: "35", label: "actividades en el mapa" },
            { value: "1", label: "mundo persistente" },
        ],
        kicker: "TU AVENTURA TE ESPERA",
        title: "VUELVE AL JUEGO",
        greet: "Entra y continúa justo donde lo dejaste.",
        user: "USUARIO",
        pass: "CONTRASEÑA",
        remember: "Recordar mi usuario",
        go: "ENTRAR",
        connecting: "CONECTANDO…",
        help: "Usuario de 3 a 20 caracteres. Contraseña de 8 como mínimo.",
        loadCache: "DESCARGANDO EL MUNDO",
        loadWorld: "ENTRANDO AL MUNDO",
        loadFirst: "La primera vez tarda más; después queda en tu navegador.",
        tips: [
            "Tu personaje sigue trabajando con el navegador cerrado, hasta 12 horas.",
            "XP, daño y botín se calculan en el servidor — nada depende de tu máquina.",
            "Elige la actividad en la pestaña Idle y ya puedes cerrar el juego.",
            "Hay 35 lugares en el mapa para entrenar. Cambia cuando quieras.",
        ],
    },
};

const STORAGE_KEY = "osi.lang";

function isLang(value: unknown): value is Lang {
    return value === "pt" || value === "en" || value === "es";
}

/** The chosen language if there is one, else the browser's if we speak it, else Portuguese. */
export function initialLanguage(): Lang {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (isLang(saved)) return saved;
    } catch {
        // Private mode: fall through to the browser's own setting.
    }
    const navigatorLang = typeof navigator !== "undefined" ? navigator.language?.slice(0, 2) : undefined;
    return isLang(navigatorLang) ? navigatorLang : "pt";
}

export function useLanguage(): [Lang, (lang: Lang) => void] {
    const [lang, setLangState] = useState<Lang>(initialLanguage);
    const setLang = useCallback((next: Lang) => {
        setLangState(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // Nothing to do: the choice lasts this session only.
        }
    }, []);
    useEffect(() => {
        document.documentElement.lang = lang === "pt" ? "pt-BR" : lang;
    }, [lang]);
    return [lang, setLang];
}
