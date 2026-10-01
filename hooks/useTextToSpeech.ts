
import { useState, useRef, useCallback, useEffect } from 'react';
import type { PlaybackState, PlaylistItem } from '../types';
import { generateSpeech } from '../services/geminiService';

// --- Audio Decoding Helper Functions ---
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext
): Promise<AudioBuffer> {
  // Check if data starts with 'RIFF' and contains 'WAVE' (standard WAV container)
  const isWav = data.length >= 12 &&
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 && // 'RIFF'
    data[8] === 0x57 && data[9] === 0x41 && data[10] === 0x56 && data[11] === 0x45;   // 'WAVE'

  let audioBuffer: AudioBuffer;

  if (isWav) {
    try {
      // AudioContext.decodeAudioData natively strips WAV headers, chunk metadata, and padding
      // Create a detached copy slice as decodeAudioData requires
      const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    } catch (err) {
      console.warn('[Audio] Native decodeAudioData failed, falling back to manual WAV header stripping:', err);
      // Fallback: Skip 44-byte WAV header so ASCII header characters are never played as PCM noise
      const headerOffset = 44;
      const rawLength = Math.max(0, data.byteLength - headerOffset);
      const alignedLength = rawLength - (rawLength % 2);
      const dataInt16 = new Int16Array(data.buffer, data.byteOffset + headerOffset, alignedLength / 2);
      const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
      const channelData = buffer.getChannelData(0);
      for (let i = 0; i < dataInt16.length; i++) {
        channelData[i] = dataInt16[i] / 32768.0;
      }
      audioBuffer = buffer;
    }
  } else {
    // Pure raw PCM without header (24kHz, 16-bit mono LE)
    const alignedLength = data.byteLength - (data.byteLength % 2);
    const dataInt16 = new Int16Array(data.buffer, data.byteOffset, alignedLength / 2);
    const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < dataInt16.length; i++) {
      channelData[i] = dataInt16[i] / 32768.0;
    }
    audioBuffer = buffer;
  }

  // Apply subtle micro fade-in and fade-out (approx 5ms = 120 samples at 24kHz)
  // This eliminates any speaker pop/click caused by non-zero start/end samples or DC offset
  const sampleRate = audioBuffer.sampleRate || 24000;
  const fadeSamples = Math.min(Math.floor(sampleRate * 0.006), Math.floor(audioBuffer.length / 10)); // ~6ms
  if (fadeSamples > 0) {
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      const len = channelData.length;
      // Linear ramp in at the beginning
      for (let i = 0; i < fadeSamples; i++) {
        channelData[i] *= (i / fadeSamples);
      }
      // Linear ramp out at the end
      for (let i = 0; i < fadeSamples; i++) {
        channelData[len - 1 - i] *= (i / fadeSamples);
      }
    }
  }

  return audioBuffer;
}
// --- End Helper Functions ---


export const useTextToSpeech = (options?: { onError?: (error: any) => void }) => {
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  const [currentItem, setCurrentItem] = useState<PlaylistItem | undefined>(undefined);
  const onErrorRef = useRef(options?.onError);
  useEffect(() => {
    onErrorRef.current = options?.onError;
  }, [options?.onError]);
  
  const playlistRef = useRef<PlaylistItem[]>([]);
  const currentItemIndexRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  
  // Cache for generated audio: key = index in playlist, value = base64 string
  const audioCacheRef = useRef<Map<number, string>>(new Map());
  // Cache for in-flight promises: key = index in playlist
  const promiseCacheRef = useRef<Map<number, Promise<string>>>(new Map());

  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        gainNodeRef.current = audioContextRef.current.createGain();
        gainNodeRef.current.connect(audioContextRef.current.destination);
      }
  }, []);

  const stop = useCallback(() => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.onended = null;
      sourceNodeRef.current.stop();
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state === 'running') {
      audioContextRef.current.suspend();
    }
    setPlaybackState('stopped');
    setCurrentItem(undefined);
    playlistRef.current = [];
    currentItemIndexRef.current = 0;
    // We keep caches on stop so re-playing is instant, but in a real app might want to clear eventually
  }, []);

  // Function to fetch audio for a specific item index (with caching and promise deduplication)
  const fetchAudioForItem = useCallback(async (index: number): Promise<string> => {
      if (index < 0 || index >= playlistRef.current.length) return "";
      
      // 1. Check if we have the result already
      if (audioCacheRef.current.has(index)) {
          return audioCacheRef.current.get(index)!;
      }
      
      // 2. Check if there is already a request pending for this index
      if (promiseCacheRef.current.has(index)) {
          console.log(`[Playback] Joining existing request for item ${index}`);
          return promiseCacheRef.current.get(index)!;
      }

      const item = playlistRef.current[index];
      // 3. Check if item has pre-calculated audio (rare in this flow but possible)
      if (item.audioB64) {
          audioCacheRef.current.set(index, item.audioB64);
          return item.audioB64;
      }

      // 4. Create new request
      console.log(`[Playback] Starting new request for item ${index}`);
      const promise = generateSpeech(item.text, item.voice, item.lang)
          .then(audioB64 => {
              // On success, move to data cache and remove from promise cache
              audioCacheRef.current.set(index, audioB64);
              promiseCacheRef.current.delete(index);
              return audioB64;
          })
          .catch(e => {
              // On error, remove from promise cache so we can try again later
              promiseCacheRef.current.delete(index);
              throw e;
          });

      promiseCacheRef.current.set(index, promise);
      return promise;
  }, []);

  // Trigger prefetching for the NEXT items
  const prefetchNext = useCallback((currentIndex: number) => {
      // Prefetch the next 3 items to ensure the pipeline is full
      // Increased from 2 to 3 to keep the queue busier given the 5.5s delay
      const itemsToPrefetch = [currentIndex + 1, currentIndex + 2, currentIndex + 3];
      
      itemsToPrefetch.forEach(nextIndex => {
        if (nextIndex < playlistRef.current.length) {
            // Only fetch if not already cached and not currently being fetched
            if (!audioCacheRef.current.has(nextIndex) && !promiseCacheRef.current.has(nextIndex)) {
                console.log(`[Playback] Queueing prefetch for item ${nextIndex}`);
                // Fire and forget (it joins the rate-limited queue)
                fetchAudioForItem(nextIndex).catch(e => console.warn(`Prefetch failed for ${nextIndex}`, e));
            }
        }
      });
  }, [fetchAudioForItem]);

  const playTrack = useCallback(async (index: number) => {
    if (index >= playlistRef.current.length) {
      stop();
      return;
    }

    // Clean up old cache to save memory (keep previous one just in case of quick prev/next)
    if (index > 2) {
        audioCacheRef.current.delete(index - 3);
    }

    currentItemIndexRef.current = index;
    const item = playlistRef.current[index];
    setCurrentItem(item);
    setPlaybackState('loading');

    try {
      initAudioContext();
      const audioContext = audioContextRef.current!;
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Fire prefetch logic immediately
      prefetchNext(index);

      // Fetch current item (awaits the same promise if prefetch already started it)
      const audioB64 = await fetchAudioForItem(index);
      
      const audioBytes = base64ToUint8Array(audioB64);
      const audioBuffer = await decodeAudioData(audioBytes, audioContext);
      
      if (sourceNodeRef.current) {
          sourceNodeRef.current.onended = null;
          sourceNodeRef.current.stop();
          sourceNodeRef.current.disconnect();
      }

      const sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(gainNodeRef.current!);
      sourceNodeRef.current = sourceNode;

      sourceNode.onended = () => {
        if (sourceNodeRef.current === sourceNode) {
          sourceNodeRef.current = null;
          // Loop to next track
          playTrack(currentItemIndexRef.current + 1);
        }
      };

      sourceNode.start(0);
      setPlaybackState('playing');
    } catch (error) {
      console.error(`Error during playback for item "${item.text.substring(0, 30)}...". Skipping.`, error);
      onErrorRef.current?.(error);
      // Skip to next on error
      playTrack(index + 1);
    }
  }, [stop, initAudioContext, fetchAudioForItem, prefetchNext]);

  const play = useCallback((items: PlaylistItem[]) => {
    if (!items || items.length === 0) return;
    stop();
    
    // Clear caches on new playlist start
    audioCacheRef.current.clear();
    promiseCacheRef.current.clear();

    setTimeout(() => {
        playlistRef.current = items;
        currentItemIndexRef.current = 0;
        playTrack(0);
    }, 50);

  }, [stop, playTrack]);

  const pause = useCallback(() => {
    if (playbackState === 'playing' && audioContextRef.current) {
      audioContextRef.current.suspend();
      setPlaybackState('paused');
    }
  }, [playbackState]);

  const resume = useCallback(() => {
    if (playbackState === 'paused' && audioContextRef.current) {
      audioContextRef.current.resume();
      setPlaybackState('playing');
    }
  }, [playbackState]);

  return {
    play,
    pause,
    resume,
    stop,
    playbackState,
    currentItem,
  };
};
