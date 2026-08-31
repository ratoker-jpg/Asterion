# Universe navigation model

Asterion uses one universe as the campaign container.

Navigation levels:

- Galaxy
- Solar system
- Planet position inside the selected system

Current MVP:

- 1 galaxy
- 40 solar systems in the galaxy
- up to 24 planet positions per solar system
- one central star at technical position 0

Planet coordinates use `[G:S:P]`, for example `[1:7:14]`.

The top Universe navigation switches only galaxy and solar system. Planet position is selected directly inside the current system rather than through a separate top-level `P` selector.
