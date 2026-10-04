# Training on Colab from the command line

The GPU is a Colab VM. An agent drives it with the [`google-colab-cli`](https://github.com/googlecolab/google-colab-cli) `colab` binary and `pipelines/colab/launch.sh`. Nobody opens a notebook for the splat run.

## One-time login, later

`launch.sh` never starts a browser and never reads a paste. Google will not allocate a VM until a token exists, and the flow that creates the token calls `input()`, which hangs an agent.

When neither `~/.config/colab-cli/token.json` nor `~/.config/gcloud/application_default_credentials.json` exists, stop. Do not paste an authorization code into the chat. The user pastes it into the terminal that is waiting for it.

The gcloud login has to request the Colab scope. Without it, every later `colab` call returns 401:

```bash
gcloud auth application-default login --no-launch-browser \
  --scopes=openid,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/colaboratory
```

Open the URL, then paste the code from the browser into that same terminal. `launch.sh` then calls `colab --auth=adc`. A login started without those scopes does not count.

`colab auth` is a different thing: it injects cloud credentials into a running VM. It does not log the CLI in. Do not suggest it for a 401.

## What an agent runs

From the repo root, after the token file exists:

```bash
pipelines/colab/launch.sh check
pipelines/colab/launch.sh all
```

Or one step at a time: `session`, `upload`, `train`, `pull`, `stop`.

| Variable | Default | Meaning |
|---|---|---|
| `COLAB_SESSION` | `pss-splat` | VM name. Always pass it; an omitted name is random. |
| `COLAB_GPU` | `A100` | `T4`, `L4`, `G4`, `A100`, `H100`. An unknown value silently becomes A100. |
| `PSS_DATA` | `data/colmap/cheyava_s56d0` | Local COLMAP tree (`images/` + `sparse/`). |
| `PSS_RUN` | `cheyava-quick` | Result folder name. |
| `PSS_MAX_STEPS` | `7000` | Quick run. Full run is `30000`. |
| `PSS_CAP_MAX` | `500000` | MCMC Gaussian cap. |
| `PSS_DATA_FACTOR` | `4` | Quarter resolution. |
| `PSS_SH_DEGREE` | `1` | |

A 400 on `colab new --gpu A100` means this account has no quota for it. The script retries a T4.

## How a long train stays alive

`colab exec --timeout` is the longest silence the local client will tolerate, not the job length. The trainer prints every step, so the connection stays up for hours. `train` uses `--timeout 28800` (8 hours of silence).

The kernel is busy for the whole `train` command, so do not send a second `colab exec` to the same session until it returns. Poll the streamed stdout. `colab status -s pss-splat` is safe; it does not use the kernel.

When `train` exits, run `pull`, then `stop`. An idle GPU keeps spending compute units. `colab usage` shows the balance.

## Files

`colab upload` sends one base64 body through the Jupyter contents API, which rejects large files. `launch.sh` splits the COLMAP archive into 8 MB parts, uploads those, and rejoins them on the VM. `pull` does the same in reverse for the newest `ckpt_*.pt` and any `.ply`.

On the VM:

- data: `/content/pss/colmap`
- results: `/content/pss/runs/<run>/{ckpts,ply,cfg.yml}`
- log: `/content/pss/logs/<run>.csv` with columns `step,loss`

If `/content/drive/MyDrive` is already mounted, the csv and each new checkpoint are copied to `/content/drive/MyDrive/pss/`. Getting that mount requires `colab drivemount` in a human terminal. Agents skip it. `pull` is what makes a finished run survive the VM.

## Commands agents must not run

| Command | Why |
|---|---|
| `colab auth` | Waits for a pasted cloud code. |
| `colab drivemount` | Waits for Enter after a browser consent. |
| `colab repl`, unpiped `colab console` | Raw TTY. A pipe is fine: `echo 'nvidia-smi' \| colab console -s pss-splat`. |
| `colab run` for the splat | Tears the VM down when the process exits, and the default silence timeout is 30s. Use `launch.sh train` on a session you already opened. |

## When the VM disappears

`colab exec` answers 401 or 404 after the backend reclaims the machine. `launch.sh session` creates it again. Training resumes only when the result dir still has a checkpoint (Drive, or a `pull` from earlier). A VM-only checkpoint is gone with the VM.
