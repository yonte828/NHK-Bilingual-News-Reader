
import { useState, useRef, useCallback } from 'react';
import type { PlaybackState, PlaylistItem } from '../types';
import { generateSpeech } from '../services/geminiService';

// --- Audio Decoding Helper Functions ---
function decode(base64: string): Uint8Array {
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
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length;
  // Mono, 24kHz sample rate as per TTS API
  const buffer = ctx.createBuffer(1, frameCount, 24000); 
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  return buffer;
}
// --- End Helper Functions ---


export const useTextToSpeech = () => {
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  const [currentItem, setCurrentItem] = useState<PlaylistItem | undefined>(undefined);
  
  const playlistRef = useRef<PlaylistItem[]>([]);
  const currentItemIndexRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

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
  }, []);

  const playTrack = useCallback(async (index: number) => {
    if (index >= playlistRef.current.length) {
      stop();
      return;
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

      const audioB64 = await generateSpeech(item.text, item.voice);
      const audioBytes = decode(audioB64);
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
          playTrack(currentItemIndexRef.current + 1);
        }
      };

      sourceNode.start(0);
      setPlaybackState('playing');
    } catch (error) {
      console.error(`Error during playback for item "${item.text.substring(0, 30)}...". Skipping.`, error);
      // Don't stop the whole playlist. Just skip to the next track.
      playTrack(index + 1);
    }
  }, [stop, initAudioContext]);

  const play = useCallback((items: PlaylistItem[]) => {
    if (!items || items.length === 0) return;
    stop();
    
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
