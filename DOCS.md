# Running this yourself

Personally, I use [Ollama](https://ollama.com/) for my LLM. It's simple, offline, and I already have it set up on my gaming PC to be accessible via the API within my network.

I won't go too much into details, but It can also be used with OpenAI or Anthropic models. See the [dotenv](./dotenv) file for all the environment variables you can use to configure how it runs.

_Note that when I tested this with an OpenAI model (the default `gpt-5.4`), it cost a single penny to generate ~15 mantras. The service also only ever uses the LLM if the content of the notes has changed, so using this service with a paid LLM should be pretty cheap._

## Sourcing notes

Again, not gonna go too much into details on this (or add support for different note sources), but you can take a look at the [src/fetch-notes.ts](./src/fetch-notes.ts) module to see how I do it.

Personally, I use [Obsidian.md](https://obsidian.md/) with the [git sync plugin](https://github.com/Vinzent03/obsidian-git) to push my notes into a private GitHub repo, that I then am able to aggregate the notes from the files/directories I'm interested in using as the source(s) of my mantras.

## Starting the service

1. Make sure you have the correct Node.js/Yarn versions installed based on the [package.json](./package.json) `volta` property (or just install [Volta](https://volta.sh/))
1. Copy [dotenv](./dotenv) into your own `.env` file and configure it to your liking
1. Install dependencies and start it:

```sh
yarn install
yarn start
```

## Integrating with Home Assistant

I recommend using the [VSCode Addon](https://github.com/hassio-addons/addon-vscode), as it's the easiest way to add everything you need for this.

To set up the automation, you just need to add/update your HASS files based on the ones in the [hass/](./hass) directory:

- `shell/get_mantra.sh`
  - create a `shell` directory inside your HASS directory, then add this file into it (may need to `chmod +x` it so it's executable)
- `configuration.yaml`
  - Add this to your existing file to enable HASS to execute the shell command
- `automation.yaml`
  - You should also already have this file. You'll need to replace a couple things for your own usage, just see the comments in that file
