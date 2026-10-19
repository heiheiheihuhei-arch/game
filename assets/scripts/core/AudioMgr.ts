import { AudioClip, AudioSource, Node, resources } from 'cc';

/** 音效统一从 resources/audio 下按名字加载、按名字播放 */
export class AudioMgr {
    private static source: AudioSource | null = null;
    private static readonly clips = new Map<string, AudioClip>();

    static init(root: Node) {
        const n = new Node('Audio');
        root.addChild(n);
        this.source = n.addComponent(AudioSource);
    }

    static preload(names: string[]) {
        for (const name of names) {
            resources.load(`audio/${name}`, AudioClip, (err, clip) => {
                if (err) { console.warn(`[AudioMgr] 加载失败 audio/${name}`, err); return; }
                this.clips.set(name, clip);
            });
        }
    }

    static play(name: string, volume = 1) {
        const clip = this.clips.get(name);
        if (clip && this.source) this.source.playOneShot(clip, volume);
    }
}
