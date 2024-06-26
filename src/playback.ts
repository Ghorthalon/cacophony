/**
 * The Playback class encapsulates the functionality for playing audio in a web application.
 * It integrates with the standardized-audio-context library to provide a cross-browser way to handle audio.
 * This class allows for the manipulation of audio playback through various features such as:
 * - Playing and stopping audio
 * - Looping audio a specific number of times or infinitely
 * - Adjusting volume and playback rate
 * - Applying stereo or 3D (HRTF) panning
 * - Adding and removing filters to modify the audio output
 * - Handling audio looping with custom logic
 * - Fading audio in and out linearly or exponentially
 * - Seeking to specific points in the audio
 * - Checking if the audio is currently playing
 * - Cleaning up resources when the audio is no longer needed
 * 
 * The class is designed to be flexible and can be used with different types of audio sources,
 * including buffer sources and media elements. It also provides detailed control over the audio's
 * spatial characteristics when using 3D audio.
 */


import { TOscillatorType } from "standardized-audio-context";
import type { BaseSound, FadeType, LoopCount, PanType, Position } from "./cacophony";
import type { AudioBuffer, AudioBufferSourceNode, AudioContext, BiquadFilterNode, GainNode, IPannerOptions, PannerNode, SourceNode, StereoPannerNode } from "./context";
import { FilterManager } from "./filters";



export class Playback extends FilterManager implements BaseSound {
    private _playing: boolean = false;
    private context: AudioContext;
    private source?: SourceNode;
    private gainNode?: GainNode;
    private panner?: PannerNode | StereoPannerNode;
    loopCount: LoopCount = 0;
    currentLoop: number = 0;
    private buffer?: AudioBuffer;
    pauseTime: number = 0;
    startTime: number = 0;

    /**
    * Creates an instance of the Playback class.
    * @param {SourceNode} source - The audio source node.
    * @param {GainNode} gainNode - The gain node for controlling volume.
    * @param {AudioContext} context - The audio context.
    * @param {LoopCount} loopCount - The number of times the audio should loop. 'infinite' for endless looping.
    * @param {PanType} panType - The type of panning to use ('HRTF' for 3D audio or 'stereo' for stereo panning).
    * @throws {Error} Throws an error if an invalid pan type is provided.
    */

    constructor(source: SourceNode, gainNode: GainNode, context: AudioContext, loopCount: LoopCount = 0, public panType: PanType = 'HRTF') {
        super();
        this.loopCount = loopCount;
        this.panType = panType;
        this.source = source;
        if ('buffer' in source && source.buffer) {
            this.buffer = source.buffer;
        }
        if ('mediaElement' in source && source.mediaElement) {
            source.mediaElement.onended = this.handleLoop;
        } else if ('onended' in source) {
            source.onended = this.handleLoop;
        } else {
            throw new Error('Unsupported source type');
        }
        this.gainNode = gainNode;
        this.context = context;
        if (this.panType === 'HRTF') {
            this.panner = context.createPanner();
        } else if (this.panType === 'stereo') {
            this.panner = context.createStereoPanner();
        } else {
            throw new Error('Invalid pan type');
        }
        this.source.connect(this.panner);
        this.panner.connect(this.gainNode);
        this.refreshFilters();
    }

    /**
    * Gets the stereo panning value.
    * @returns {number | null} The current stereo pan value, or null if stereo panning is not applicable.
    * @throws {Error} Throws an error if stereo panning is not available or if the sound has been cleaned up.
    */

    get stereoPan(): number | null {
        if (this.panType === 'stereo') {
            return (this.panner as StereoPannerNode).pan.value;
        }
        return null;
    }

    /**
    * Sets the stereo panning value.
    * @param {number} value - The stereo pan value to set, between -1 (left) and 1 (right).
    * @throws {Error} Throws an error if stereo panning is not available, if the sound has been cleaned up, or if the value is out of bounds.
    */

    set stereoPan(value: number) {
        if (this.panType !== 'stereo') {
            throw new Error('Stereo panning is not available when using HRTF.');
        }
        if (!this.panner) {
            throw new Error('Cannot set stereo pan of a sound that has been cleaned up');
        }
        (this.panner as StereoPannerNode).pan.setValueAtTime(clamp(value, -1, 1), this.context.currentTime);
    }

    /**
    * Gets the duration of the audio in seconds.
    * @returns {number} The duration of the audio.
    * @throws {Error} Throws an error if the sound has been cleaned up.
    */

    get duration() {
        if (!this.buffer) {
            throw new Error('Cannot get duration of a sound that has been cleaned up');
        }
        return this.buffer.duration;
    }

    /**
    * Gets the current playback rate of the audio.
    * @returns {number} The current playback rate.
    * @throws {Error} Throws an error if the sound has been cleaned up or if the source type is unsupported.
    */

    get playbackRate() {
        if (!this.source) {
            throw new Error('Cannot get playback rate of a sound that has been cleaned up');
        }
        if ('playbackRate' in this.source) {
            return this.source.playbackRate.value;
        }
        if ('mediaElement' in this.source && this.source.mediaElement) {
            return this.source.mediaElement.playbackRate;
        }
        throw new Error('Unsupported source type');
    }

    /**
    * Sets the playback rate of the audio.
    * @param {number} rate - The playback rate to set.
    * @throws {Error} Throws an error if the sound has been cleaned up or if the source type is unsupported.
    */

    set playbackRate(rate: number) {
        if (!this.source) {
            throw new Error('Cannot set playback rate of a sound that has been cleaned up');
        }
        if ('playbackRate' in this.source) {
            this.source.playbackRate.value = rate;
        }
        if ('mediaElement' in this.source && this.source.mediaElement) {
            this.source.mediaElement.playbackRate = rate;
        }
    }

    /**
    * Handles the loop event when the audio ends.
    * This method is bound to the 'onended' event of the audio source.
    * It manages looping logic and restarts playback if necessary.
    */

    handleLoop = () => {
        if (!this.source) {
            return;
        }
        this.currentLoop++;
        if (this.loopCount !== 'infinite' && this.currentLoop > this.loopCount) {
            this._playing = false;
            this.stop();
        }
        if (this.loopCount === 'infinite' || this.currentLoop < this.loopCount) {
            if (this.buffer) {
                this.recreateSource();
                if (this._playing) {
                    (this.source as AudioBufferSourceNode).start(0);
                    this._playing = true;
                }
            } else {
                if (this._playing) {
                    this.seek(0);
                }
            }
        } else {
            this._playing = false;
        }
    }

    private recreateSource() {
        if (!this.buffer || !this.source || !this.panner || !this.context || !this.gainNode) {
            throw new Error('Cannot recreate source of a sound that has been cleaned up');
        }
        this.source = this.context.createBufferSource();
        this.source.buffer = this.buffer;
        this.source.connect(this.panner);
        this.source.onended = this.handleLoop;
    }

    /**
    * Starts playing the audio.
    * @returns {[this]} Returns the instance of the Playback class for chaining.
    * @throws {Error} Throws an error if the sound has been cleaned up.
    */

    play(): [this] {
        if (!this.source) {
            throw new Error('Cannot play a sound that has been cleaned up');
        }
        if ('mediaElement' in this.source && this.source.mediaElement) {
            this.source.mediaElement.play();
        } else if ('start' in this.source && this.source.start) {
            const offset = this.pauseTime ? this.pauseTime : 0;
            this.source.start(0, offset);
        }
        this._playing = true;
        return [this];
    }

    pause(): void {
        if (!this.source) {
            throw new Error('Cannot pause a sound that has been cleaned up');
        }
        if ('mediaElement' in this.source && this.source.mediaElement) {
            this.source.mediaElement.pause();
        } else if ('stop' in this.source && this.source.stop) {
            this.pauseTime = this.context.currentTime - this.startTime;
            this.source.stop();
        }
        this._playing = false;
    }

    /**
    * Gets the 3D audio options if HRTF panning is used.
    * @returns {IPannerOptions} The current 3D audio options.
    * @throws {Error} Throws an error if the sound has been cleaned up or if HRTF panning is not used.
    */

    get threeDOptions(): IPannerOptions {
        if (!this.panner) {
            throw new Error('Cannot get 3D options of a sound that has been cleaned up');
        }
        if (this.panType !== 'HRTF') {
            throw new Error('Cannot get 3D options of a sound that is not using HRTF');
        }
        const panner = this.panner as PannerNode;
        return {
            coneInnerAngle: panner.coneInnerAngle,
            coneOuterAngle: panner.coneOuterAngle,
            coneOuterGain: panner.coneOuterGain,
            distanceModel: panner.distanceModel,
            maxDistance: panner.maxDistance,
            channelCount: this.panner.channelCount,
            channelCountMode: panner.channelCountMode,
            channelInterpretation: panner.channelInterpretation,
            panningModel: panner.panningModel,
            refDistance: panner.refDistance,
            rolloffFactor: panner.rolloffFactor,
            positionX: panner.positionX.value,
            positionY: panner.positionY.value,
            positionZ: panner.positionZ.value,
            orientationX: panner.orientationX.value,
            orientationY: panner.orientationY.value,
            orientationZ: panner.orientationZ.value
        }
    }

    /**
 * Sets the 3D audio options for HRTF panning.
 * @param {Partial<IPannerOptions>} options - The 3D audio options to set.
 * @throws {Error} Throws an error if the sound has been cleaned up or if HRTF panning is not used.
 */
    set threeDOptions(options: Partial<IPannerOptions>) {
        if (!this.panner) {
            throw new Error('Cannot set 3D options of a sound that has been cleaned up');
        }
        if (this.panType !== 'HRTF') {
            throw new Error('Cannot set 3D options of a sound that is not using HRTF');
        }
        const panner = this.panner as PannerNode;
        panner.coneInnerAngle = options.coneInnerAngle !== undefined ? options.coneInnerAngle : panner.coneInnerAngle;
        panner.coneOuterAngle = options.coneOuterAngle !== undefined ? options.coneOuterAngle : panner.coneOuterAngle;
        panner.coneOuterGain = options.coneOuterGain !== undefined ? options.coneOuterGain : panner.coneOuterGain;
        panner.distanceModel = options.distanceModel || panner.distanceModel;
        panner.maxDistance = options.maxDistance !== undefined ? options.maxDistance : panner.maxDistance;
        panner.channelCount = options.channelCount !== undefined ? options.channelCount : panner.channelCount;
        panner.channelCountMode = options.channelCountMode || panner.channelCountMode;
        panner.channelInterpretation = options.channelInterpretation || panner.channelInterpretation;
        panner.panningModel = options.panningModel || panner.panningModel;
        panner.refDistance = options.refDistance !== undefined ? options.refDistance : panner.refDistance;
        panner.rolloffFactor = options.rolloffFactor !== undefined ? options.rolloffFactor : panner.rolloffFactor;
        panner.positionX.value = options.positionX !== undefined ? options.positionX : panner.positionX.value;
        panner.positionY.value = options.positionY !== undefined ? options.positionY : panner.positionY.value;
        panner.positionZ.value = options.positionZ !== undefined ? options.positionZ : panner.positionZ.value;
        panner.orientationX.value = options.orientationX !== undefined ? options.orientationX : panner.orientationX.value;
        panner.orientationY.value = options.orientationY !== undefined ? options.orientationY : panner.orientationY.value;
        panner.orientationZ.value = options.orientationZ !== undefined ? options.orientationZ : panner.orientationZ.value;
    }

    /**
    * Seeks to a specific time in the audio.
    * @param {number} time - The time in seconds to seek to.
    * @throws {Error} Throws an error if the sound has been cleaned up or if the source type is unsupported.
    */

    seek(time: number): void {
        if (!this.source || !this.gainNode || !this.panner) {
            throw new Error('Cannot seek a sound that has been cleaned up');
        }
        const playing = this.isPlaying;
        this.stop();
        if ('mediaElement' in this.source && this.source.mediaElement) {
            this.source.mediaElement.currentTime = time;
            if (playing) {
                this.source.mediaElement.play();
            }
        } else if (this.buffer) {
            // Create a new source to start from the desired time
            this.source = this.context.createBufferSource();
            this.source.buffer = this.buffer;
            this.source.onended = this.handleLoop;
            this.refreshFilters();
            this.source.connect(this.panner);
            if (playing) {
                this.source.start(0, time);
            }
        } else {
            throw new Error('Unsupported source type for seeking');
        }
    }

    /**
    * Gets the current volume of the audio.
    * @throws {Error} Throws an error if the sound has been cleaned up.
    * @returns {number} The current volume.
    */

    get volume(): number {
        if (!this.gainNode) {
            throw new Error('Cannot get volume of a sound that has been cleaned up');
        }
        return this.gainNode.gain.value;
    }

    /**
 * Sets the volume of the audio.
 * @param {number} v - The volume to set.
 * @throws {Error} Throws an error if the sound has been cleaned up.
 */
    set volume(v: number) {
        if (!this.gainNode) {
            throw new Error('Cannot set volume of a sound that has been cleaned up');
        }
        this.gainNode.gain.value = v;
    }

    /**
 * Sets whether the audio source should loop.
 * @param {boolean} loop - Whether the audio should loop.
 * @throws {Error} Throws an error if the sound has been cleaned up.
 */
    set sourceLoop(loop: boolean) {
        if (!this.source) {
            throw new Error('Cannot set loop on a sound that has been cleaned up');
        }
        if ('loop' in this.source) {
            this.source.loop = loop;
        }
        if ("mediaElement" in this.source && this.source.mediaElement) {
            this.source.mediaElement.loop = loop;
        }
    }

    /**
    * Fades in the audio from silence to its current volume level over a specified duration.
    * @param {number} time - The duration in seconds for the fade-in.
    * @param {FadeType} fadeType - The type of fade curve ('linear' or 'exponential').
    * @returns {Promise<void>} A promise that resolves when the fade-in is complete.
    * @throws {Error} Throws an error if the sound has been cleaned up.
    * @throws {Error} Throws an error if the sound has been cleaned up.
    */

    fadeIn(time: number, fadeType: FadeType = 'linear'): Promise<void> {
        return new Promise(resolve => {
            if (!this.gainNode) {
                throw new Error('Cannot fade in a sound that has been cleaned up');
            }

            const initialVolume = this.gainNode.gain.value;
            const targetVolume = 1; // Assuming the target volume after fade-in is 1 (full volume)

            // Reset volume to 0 to start the fade-in process
            this.gainNode.gain.value = 0;

            switch (fadeType) {
                case 'exponential':
                    // Start at a low value (0.01) because exponentialRampToValueAtTime cannot ramp from 0
                    this.gainNode.gain.setValueAtTime(0.01, this.context.currentTime);
                    this.gainNode.gain.exponentialRampToValueAtTime(targetVolume, this.context.currentTime + time);
                    break;
                case 'linear':
                    this.gainNode.gain.linearRampToValueAtTime(targetVolume, this.context.currentTime + time);
                    break;
            }

            // Resolve the Promise after the fade-in time
            setTimeout(() => {
                // Ensure the final volume is set to the target volume
                if (!this.gainNode) {
                    throw new Error('Cannot fade in a sound that has been cleaned up');
                }
                this.gainNode.gain.value = targetVolume;
                resolve();
            }, time * 1000);
        });
    }

    /**
    * Fades out the audio to silence over a specified duration.
    * @param {number} time - The duration in seconds for the fade-out.
    * @param {FadeType} fadeType - The type of fade curve ('linear' or 'exponential').
    * @returns {Promise<void>} A promise that resolves when the fade-out is complete.
    * @throws {Error} Throws an error if the sound has been cleaned up.
    */

    fadeOut(time: number, fadeType: FadeType = 'linear'): Promise<void> {
        return new Promise(resolve => {
            // Storing the current gain value
            if (!this.gainNode) {
                throw new Error('Cannot fade out a sound that has been cleaned up');
            }
            const initialVolume = this.gainNode.gain.value;
            switch (fadeType) {
                case 'exponential':
                    // Scheduling an exponential fade down
                    this.gainNode.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + time);
                    break;
                case 'linear':

                    // Scheduling a linear ramp to 0 over the given duration
                    this.gainNode.gain.linearRampToValueAtTime(0, this.context.currentTime + time);
            }
            // Resolving the Promise after the fade-out time
            setTimeout(() => resolve(), time * 1000);
        });
    }

    /**
    * Checks if the audio is currently playing.
    * @returns {boolean} True if the audio is playing, false otherwise.
    */

    get isPlaying(): boolean {
        if (!this.source) {
            return false;
        }
        return this._playing;
    }

    /**
    * Cleans up resources used by the Playback instance.
    * This method should be called when the audio is no longer needed to free up resources.
    */

    cleanup(): void {
        // Ensure cleanup is idempotent
        if (this.source) {
            this.source.disconnect();
            this.source = undefined;
        }
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = undefined;
        }
        this._filters.forEach(filter => {
            if (filter) {
                filter.disconnect();
            }
        });
        this._filters = [];
    }

    /**
    * Sets or gets the loop count for the audio.
    * @param {LoopCount} loopCount - The number of times the audio should loop. 'infinite' for endless looping.
    * @returns {LoopCount} The loop count if no parameter is provided.
    * @throws {Error} Throws an error if the sound has been cleaned up or if the source type is unsupported.
    */

    loop(loopCount?: LoopCount): LoopCount {
        if (!this.source) {
            throw new Error('Cannot loop a sound that has been cleaned up');
        }
        if ('mediaElement' in this.source && this.source.mediaElement) {
            const mediaElement = this.source.mediaElement;
            if (loopCount === undefined) {
                return mediaElement.loop === true ? 'infinite' : 0;
            }
            mediaElement.loop = true;
            // Looping for HTMLMediaElement is controlled by the 'loop' attribute, no need for loopStart or loopEnd
            return mediaElement.loop === true ? 'infinite' : 0;

        } else if ('loop' in this.source) {
            if (loopCount === undefined) {
                return this.source.loop === true ? 'infinite' : 0;
            }
            this.source.loop = true;
            this.source.loopEnd = this.source.buffer?.duration || 0;
            this.source.loopStart = 0;
            return this.source.loop === true ? 'infinite' : 0;

        }

        throw new Error('Unsupported source type');
    }

    /**
    * Stops the audio playback immediately.
    * @throws {Error} Throws an error if the sound has been cleaned up.
    */

    stop(): void {
        if (!this.source) {
            throw new Error('Cannot stop a sound that has been cleaned up');
        }
        if (!this.isPlaying) {
            return;
        }
        try {
            if ('stop' in this.source) {
                this.source.stop();
            }
            if ("mediaElement" in this.source && this.source.mediaElement) {
                this.source.mediaElement.pause();
                this.source.mediaElement.currentTime = 0;
            }
        } catch (e) {
        }
        this._playing = false;
        this.startTime = 0;
        this.pauseTime = 0;
    }

    /**
    * Adds a filter to the audio signal chain.
    * @param {BiquadFilterNode} filter - The filter to add.
    */

    addFilter(filter: BiquadFilterNode): void {
        // we have to clone the filter to avoid reusing the same filter node
        const newFilter = filter.context.createBiquadFilter();
        newFilter.type = filter.type;
        newFilter.frequency.value = filter.frequency.value;
        newFilter.Q.value = filter.Q.value;
        super.addFilter(newFilter);
        this.refreshFilters();
    }

    /**
    * Removes a filter from the audio signal chain.
    * @param {BiquadFilterNode} filter - The filter to remove.
    */
    removeFilter(filter: BiquadFilterNode): void {
        super.removeFilter(filter);
        this.refreshFilters();
    }

    /**
    * Sets the position of the audio source in 3D space (HRTF panning only).
    * @param {Position} position - The [x, y, z] coordinates of the audio source.
    * @throws {Error} Throws an error if the sound has been cleaned up or if HRTF panning is not used.
    */

    set position(position: Position) {
        if (!this.panner) {
            throw new Error('Cannot move a sound that has been cleaned up');
        }
        if (this.panType !== 'HRTF') {
            throw new Error('Cannot move a sound that is not using HRTF');
        }
        const [x, y, z] = position;
        const panner = this.panner as PannerNode;
        panner.positionX.value = x;
        panner.positionY.value = y;
        panner.positionZ.value = z;
    }

    /**
    * Gets the position of the audio source in 3D space (HRTF panning only).
    * @returns {Position} The [x, y, z] coordinates of the audio source.
    * @throws {Error} Throws an error if the sound has been cleaned up or if HRTF panning is not used.
    */

    get position(): Position {
        if (!this.panner) {
            throw new Error('Cannot get position of a sound that has been cleaned up');
        }
        if (this.panType !== 'HRTF') {
            throw new Error('Cannot get position of a sound that is not using HRTF');
        }
        const panner = this.panner as PannerNode;
        return [panner.positionX.value, panner.positionY.value, panner.positionZ.value];
    }

    /**
    * Refreshes the audio filters by re-applying them to the audio signal chain.
    * This method is called internally whenever filters are added or removed.
    * @throws {Error} Throws an error if the sound has been cleaned up.
    */
    private refreshFilters(): void {

        if (!this.panner || !this.gainNode) {
            throw new Error('Cannot update filters on a sound that has been cleaned up');
        }
        let connection = this.panner;
        connection.disconnect();
        connection = this.applyFilters(connection);
        connection.connect(this.gainNode);
    }

    // I'm not sure I like this. Should oscillator playback be extended from playback?
    public isOscillator(): boolean {
        return this.source ? 'frequency' in this.source && 'type' in this.source : false;
    }

    get type(): TOscillatorType | undefined {
        if (!this.isOscillator() || !this.source) {
            throw new Error('Cannot get type of a sound that is not an oscillator');
        }
        if (this.source instanceof OscillatorNode) return (this.source as OscillatorNode).type;
    }

    set type(type: TOscillatorType) {
        if (!this.isOscillator() || !this.source) {
            throw new Error('Cannot set type of a sound that is not an oscillator');
        }
        if (this.source instanceof OscillatorNode) (this.source as OscillatorNode).type = type;
    }

    get frequency(): number|undefined {
        if (!this.isOscillator() || !this.source) {
            throw new Error('Cannot get frequency of a sound that is not an oscillator');
        }
        if (this.source instanceof OscillatorNode) return (this.source as OscillatorNode).frequency.value;
    }
    set frequency(frequency: number) {
        if (!this.isOscillator() || !this.source) {
            throw new Error('Cannot set frequency of a sound that is not an oscillator');
        }
        if (this.source instanceof OscillatorNode) (this.source as OscillatorNode).frequency.value = frequency;
    }

    set periodicWave(wave: PeriodicWave) {
        if (!this.isOscillator() || !this.source) {
            throw new Error('Cannot set periodic wave of a sound that is not an oscillator');
        }
        if (this.source instanceof OscillatorNode) (this.source as OscillatorNode).setPeriodicWave(wave);
    }
    /**
    * Creates a clone of the current Playback instance with optional overrides for certain properties.
    * This method allows for the creation of a new Playback instance that shares the same audio context
    * and source node but can have different settings such as loop count or pan type.
    * @param {Partial<Playback>} overrides - An object containing properties to override in the cloned instance.
    * @returns {Playback} A new Playback instance cloned from the current one with the specified overrides applied.
    * @throws {Error} Throws an error if the sound has been cleaned up.
    */

    clone(overrides: Partial<{ loopCount: LoopCount; panType: PanType }> = {}): Playback {
        if (!this.source || !this.gainNode || !this.context) {
            throw new Error('Cannot clone a sound that has been cleaned up');
        }

        const panType = overrides.panType || this.panType;
        // we'll need to create a new gain node
        const gainNode = this.context.createGain();
        // clone the source node
        let source: SourceNode;
        if ('buffer' in this.source && this.source.buffer) {
            source = this.context.createBufferSource();
            source.buffer = this.source.buffer;
        } else if ('mediaElement' in this.source && this.source.mediaElement) {
            source = this.context.createMediaElementSource(this.source.mediaElement);
        } else {
            throw new Error('Unsupported source type');
        }
        const loopCount = overrides.loopCount !== undefined ? overrides.loopCount : this.loopCount;
        return new Playback(source, gainNode, this.context, loopCount, panType);
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
