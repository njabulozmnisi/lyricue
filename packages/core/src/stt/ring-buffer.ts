export class Float32RingBuffer {
    readonly capacity: number
    #buffer: Float32Array
    #start = 0
    #size = 0

    constructor(capacity: number) {
        if (!Number.isInteger(capacity) || capacity <= 0) throw new Error("capacity must be a positive integer")
        this.capacity = capacity
        this.#buffer = new Float32Array(capacity)
    }

    get size(): number {
        return this.#size
    }

    push(samples: Float32Array): void {
        if (samples.length >= this.capacity) {
            this.#buffer.set(samples.subarray(samples.length - this.capacity))
            this.#start = 0
            this.#size = this.capacity
            return
        }

        for (let i = 0; i < samples.length; i++) {
            const writeIndex = (this.#start + this.#size) % this.capacity
            this.#buffer[writeIndex] = samples[i] ?? 0
            if (this.#size < this.capacity) {
                this.#size++
            } else {
                this.#start = (this.#start + 1) % this.capacity
            }
        }
    }

    snapshot(): Float32Array {
        const out = new Float32Array(this.#size)
        for (let i = 0; i < this.#size; i++) out[i] = this.#buffer[(this.#start + i) % this.capacity] ?? 0
        return out
    }
}
