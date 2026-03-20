"""Bark command-line interface for text-to-audio generation."""

import argparse
import sys

import numpy as np
from scipy.io.wavfile import write as write_wav

from .api import generate_audio, save_as_prompt
from .generation import SAMPLE_RATE, preload_models


def main():
    parser = argparse.ArgumentParser(
        description="Bark: text-to-audio generation from the command line"
    )
    parser.add_argument("text", nargs="?", help="Text to convert to audio")
    parser.add_argument(
        "--input", "-i",
        type=str,
        help="Read input text from a file instead of command line",
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default="bark_output.wav",
        help="Output WAV file path (default: bark_output.wav)",
    )
    parser.add_argument(
        "--history-prompt",
        type=str,
        default=None,
        help="Voice preset to use, e.g. 'v2/en_speaker_1'",
    )
    parser.add_argument(
        "--text-temp",
        type=float,
        default=0.7,
        help="Text generation temperature (default: 0.7)",
    )
    parser.add_argument(
        "--waveform-temp",
        type=float,
        default=0.7,
        help="Waveform generation temperature (default: 0.7)",
    )
    parser.add_argument(
        "--save-prompt",
        type=str,
        default=None,
        help="Save full generation as a voice prompt .npz file",
    )
    parser.add_argument(
        "--silent",
        action="store_true",
        help="Disable progress bars",
    )

    args = parser.parse_args()

    # Get input text
    if args.input:
        with open(args.input, "r") as f:
            text = f.read().strip()
    elif args.text:
        text = args.text
    elif not sys.stdin.isatty():
        text = sys.stdin.read().strip()
    else:
        parser.error("Please provide text as an argument, via --input file, or through stdin")

    if not text:
        parser.error("Input text is empty")

    # Generate audio
    print(f"Loading models...")
    preload_models()

    print(f"Generating audio for: {text[:80]}{'...' if len(text) > 80 else ''}")
    output_full = args.save_prompt is not None

    result = generate_audio(
        text,
        history_prompt=args.history_prompt,
        text_temp=args.text_temp,
        waveform_temp=args.waveform_temp,
        silent=args.silent,
        output_full=output_full,
    )

    if output_full:
        full_generation, audio_arr = result
        save_as_prompt(args.save_prompt, full_generation)
        print(f"Voice prompt saved to: {args.save_prompt}")
    else:
        audio_arr = result

    # Save output
    write_wav(args.output, SAMPLE_RATE, audio_arr)
    print(f"Audio saved to: {args.output}")


if __name__ == "__main__":
    main()
