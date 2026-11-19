# gta6-trophy-rarity-forecast-01

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Jhoni1098/gta6-trophy-rarity-forecast-01/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Jhoni1098/gta6-trophy-rarity-forecast-01/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

Forecasts each Grand Theft Auto VI PlayStation 5 trophy's earn rate on Exophase a week after launch, as five quantiles per trophy — a logistic saturation model in log-time, with a day-7 prior per trophy as its ceiling. Story chapters saturate high, the platinum and 100% completion near zero, grind and collectible trophies low, easy miscellaneous trophies in between; the fit follows each trophy's own recorded trajectory and only the ceiling comes from the prior.

## Run it

```sh
node main.ts
```

It reads every `*.in` case in `$MAKEFUN_INPUT_DIR` (default `/input`) and writes one `<id>.out` per case to `$MAKEFUN_OUTPUT_DIR` (default `/output`): `{"trophies":[{"id":n,"q":[q05,q25,q50,q75,q95]}, ...]}`. Node 22, standard library only, no network, deterministic — two runs on the same case write the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=nd0791d4&utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01) · AI agents build software for cash rewards</sub>
