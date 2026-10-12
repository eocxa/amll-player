import {
	Button,
	Callout,
	Dialog,
	Flex,
	Text,
	TextField,
} from "@radix-ui/themes";
import { type FC, useCallback, useState } from "react";
import { toast } from "react-toastify";
import { db, type Song } from "../../utils/db-client.ts";

export const ServerSyncDialog: FC<{
	opened: boolean;
	onOpenChange: (open: boolean) => void;
	targetPlaylistId?: number;
}> = ({ opened, onOpenChange, targetPlaylistId }) => {
	const [serverUrl, setServerUrl] = useState(() => {
		return localStorage.getItem("music_server_url") || "http://100.82.180.79:8000";
	});
	const [isTesting, setIsTesting] = useState(false);
	const [isSyncing, setIsSyncing] = useState(false);
	const [testStatus, setTestStatus] = useState<{
		success: boolean;
		message: string;
		trackCount?: number;
	} | null>(null);

	const cleanUrl = useCallback((raw: string) => {
		let u = raw.trim();
		if (!u.startsWith("http://") && !u.startsWith("https://")) {
			u = `http://${u}`;
		}
		return u.replace(/\/+$/, "");
	}, []);

	const testConnection = useCallback(async () => {
		const url = cleanUrl(serverUrl);
		setIsTesting(true);
		setTestStatus(null);
		try {
			const res = await fetch(`${url}/api/library`, {
				headers: { Accept: "application/json" },
			});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}: ${res.statusText}`);
			}
			const data = await res.json();
			const count = Array.isArray(data.tracks) ? data.tracks.length : 0;
			localStorage.setItem("music_server_url", url);
			setTestStatus({
				success: true,
				message: `Conexión exitosa. Se encontraron ${count} canciones en el servidor.`,
				trackCount: count,
			});
		} catch (err) {
			setTestStatus({
				success: false,
				message: `No se pudo conectar: ${err instanceof Error ? err.message : String(err)}`,
			});
		} finally {
			setIsTesting(false);
		}
	}, [cleanUrl, serverUrl]);

	const syncLibrary = useCallback(async () => {
		const url = cleanUrl(serverUrl);
		setIsSyncing(true);
		const toastId = toast.loading("Sincronizando biblioteca desde el servidor...");

		try {
			localStorage.setItem("music_server_url", url);
			const res = await fetch(`${url}/api/library`, {
				headers: { Accept: "application/json" },
			});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}: ${res.statusText}`);
			}
			const data = await res.json();
			const tracks = Array.isArray(data.tracks) ? data.tracks : [];

			if (tracks.length === 0) {
				toast.update(toastId, {
					render: "El servidor no devolvió canciones.",
					type: "warning",
					isLoading: false,
					autoClose: 4000,
				});
				setIsSyncing(false);
				return;
			}

			const songsToUpsert: Song[] = tracks.map((t: any) => {
				const isTtml =
					t.lyrics_type === "ttml" ||
					(typeof t.raw_ttml === "string" && t.raw_ttml.includes("<tt"));

				const lyricStr = t.raw_ttml || t.raw_lrc || "";
				const lyricFormat = isTtml ? "ttml" : t.lyrics_type === "lrc" ? "lrc" : "none";

				return {
					id: `server_${t.id}`,
					filePath: `${url}/api/audio/${t.id}`,
					songName: t.title || t.filename || "Canción",
					songArtists: t.artist || "Desconocido",
					songAlbum: t.album || "Desconocido",
					lyricFormat,
					lyric: lyricStr,
					duration: Number(t.duration) || 0,
					coverPath: `${url}/api/cover/${t.id}`,
				};
			});

			await db.songs.upsert(songsToUpsert);

			const songIds = songsToUpsert.map((s) => s.id);
			let playlistId = targetPlaylistId;

			if (!playlistId) {
				// Crear o buscar lista de reproducción por defecto
				const allPlaylists = await db.playlists.getAll();
				const existing = allPlaylists.find((p) => p.playlist.name === "Servidor Tailscale");
				if (existing) {
					playlistId = existing.playlist.id;
				} else {
					playlistId = await db.playlists.create("Servidor Tailscale");
				}
			}

			await db.playlists.addSongs(playlistId, songIds);

			toast.update(toastId, {
				render: `¡Se sincronizaron ${songsToUpsert.length} canciones con éxito!`,
				type: "success",
				isLoading: false,
				autoClose: 4000,
			});

			onOpenChange(false);
		} catch (err) {
			toast.update(toastId, {
				render: `Error al sincronizar: ${err instanceof Error ? err.message : String(err)}`,
				type: "error",
				isLoading: false,
				autoClose: 5000,
			});
		} finally {
			setIsSyncing(false);
		}
	}, [cleanUrl, onOpenChange, serverUrl, targetPlaylistId]);

	return (
		<Dialog.Root open={opened} onOpenChange={onOpenChange}>
			<Dialog.Content style={{ maxWidth: 500 }}>
				<Dialog.Title>Servidor de Música (Tailscale / HTTP)</Dialog.Title>
				<Dialog.Description size="2" mb="4" color="gray">
					Introduce la dirección IP de Tailscale o URL de tu servidor de música para obtener y reproducir canciones con letras sincronizadas.
				</Dialog.Description>

				<Flex direction="column" gap="3">
					<Flex direction="column" gap="1">
						<Text size="2" weight="medium">
							URL del Servidor
						</Text>
						<TextField.Root
							value={serverUrl}
							placeholder="http://100.x.y.z:8000"
							onChange={(e) => setServerUrl(e.target.value)}
						/>
					</Flex>

					<Flex gap="2">
						<Button
							variant="soft"
							onClick={testConnection}
							disabled={isTesting || isSyncing}
						>
							{isTesting ? "Comprobando..." : "Probar Conexión"}
						</Button>
					</Flex>

					{testStatus && (
						<Callout.Root color={testStatus.success ? "green" : "red"}>
							<Callout.Text>{testStatus.message}</Callout.Text>
						</Callout.Root>
					)}
				</Flex>

				<Flex gap="3" mt="5" justify="end">
					<Dialog.Close>
						<Button variant="soft" color="gray">
							Cancelar
						</Button>
					</Dialog.Close>
					<Button
						onClick={syncLibrary}
						disabled={isSyncing || isTesting}
					>
						{isSyncing ? "Sincronizando..." : "Sincronizar Canciones"}
					</Button>
				</Flex>
			</Dialog.Content>
		</Dialog.Root>
	);
};
