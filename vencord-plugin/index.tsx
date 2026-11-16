/*
 * rpc4SoundCloud Enhanced — Vencord plugin
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Activity } from "@vencord/discord-types";
import { ActivityType } from "@vencord/discord-types/enums";
import { ApplicationAssetUtils, FluxDispatcher } from "@webpack/common";

interface NowPlaying {
    title: string | null;
    artist: string | null;
    artworkUrl: string | null;
    playing: boolean;
    buffering: boolean;
    positionSeconds: number | null;
    durationSeconds: number | null;
    url: string;
}

export const settings = definePluginSettings({
    relayPort: {
        type: OptionType.NUMBER,
        description: "Port the local rpc4SoundCloud relay server is listening on",
        default: 6989,
    },
    appId: {
        type: OptionType.STRING,
        description: "Discord Application ID (from the Developer Portal). Required for artwork to render.",
        default: "",
    },
});

let socket: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let activityRequestId = 0;

async function resolveArtwork(appId: string, url: string): Promise<string | undefined> {
    try {
        const [assetId] = await ApplicationAssetUtils.fetchAssetIds(appId, [url]);
        return assetId;
    } catch (e) {
        console.error("[rpc4SoundCloud] failed to resolve artwork asset", e);
        return undefined;
    }
}

async function buildActivity(data: NowPlaying): Promise<Activity | undefined> {
    if (!data.title || !data.playing || data.buffering) return undefined;

    const appId = settings.store.appId || "0";
    const title = data.title.trim();
    const artist = data.artist?.trim();
    if (!title) return undefined;

    const activity: Activity = {
        application_id: appId,
        name: "SoundCloud",
        details: title,
        state: artist && artist.toLowerCase() !== title.toLowerCase() ? artist : undefined,
        type: ActivityType.LISTENING,
        flags: 1 << 0,
    };

    if (data.playing && !data.buffering && data.positionSeconds !== null) {
        const start = Date.now() - data.positionSeconds * 1000;
        activity.timestamps = { start };

        if (
            data.durationSeconds !== null &&
            Number.isFinite(data.durationSeconds) &&
            data.durationSeconds > data.positionSeconds
        ) {
            activity.timestamps.end = start + data.durationSeconds * 1000;
        }
    }

    if (data.artworkUrl && settings.store.appId) {
        const assetId = await resolveArtwork(appId, data.artworkUrl);
        if (assetId) {
            activity.assets = {
                large_image: assetId,
            };
        }
    }

    return activity;
}

function pushActivity(activity: Activity | undefined) {
    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        activity: activity ?? null,
        socketId: "rpc4SoundCloud",
    });
}

function connect() {
    const port = settings.store.relayPort || 6989;
    socket = new WebSocket(`ws://127.0.0.1:${port}`);

    socket.onopen = () => console.log("[rpc4SoundCloud] connected to relay");

    socket.onmessage = async event => {
        try {
            const requestId = ++activityRequestId; 
            const data: NowPlaying | null = JSON.parse(event.data);
            const activity = data ? await buildActivity(data) : undefined;
            
            if (requestId === activityRequestId) {
                pushActivity(activity);
            }
        } catch (e) {
            console.error("[rpc4SoundCloud] bad payload from relay", e);
        }
    };

    socket.onclose = () => {
        activityRequestId++; 
        pushActivity(undefined);
        reconnectTimeout = setTimeout(connect, 3000);
    };

    socket.onerror = () => socket?.close();
}

function disconnect() {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    socket?.close();
    socket = null;
    activityRequestId++; 
    pushActivity(undefined);
}

export default definePlugin({
    name: "rpc4SoundCloud",
    description: "Shows what you're listening to on SoundCloud as a Discord Rich Presence, fed live from a browser extension.",
    authors: [{ name: "you", id: 0n }],
    settings,

    start() {
        connect();
    },
    stop() {
        disconnect();
    },
});
