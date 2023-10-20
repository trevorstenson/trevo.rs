---
title: "WASM Seam Carving"
date: "2023-10-19"
tags: ["rust", "wasm"]
description: "Shrinking images with WASM"
---

I was recently feeling nostalgic of my time in college and decided to take a look at all of my old programming projects. One of my favorites that initially exposed me to both the usefulness of dynamic programming, as well as a surprisingly straightforward way to resize images, was writing a seam carving implementation for my algorithms class. [Seam carving](https://en.wikipedia.org/wiki/Seam_carving) is a method for resizing images that tries to preserve the most important parts of the image by removing the 'least important' pixels.

I decided to take the opportunity to rewrite my original implementation this weekend. I figured the obvious choice was Rust + WebAssembly, since I both wanted to be browser-native, and wanted to get actual experience with Rust.

## Approach

The algorithm for seam carving is relatively simple. 

1. Calculate the energy of each pixel in the image
2. Find the lowest energy seam
3. Remove the seam from the image
4. Repeat!

## Implementation

The key to this process is how we identify the least-important pixels to remove. To find this, we need some metric for determining the importance of each pixel. A very common approach for this is determining the energy of each pixel, a measure of how much the pixel stands out from its neighbors. The higher the energy, the more important the pixel is:

This formula can be expressed as the sum of the squared differences between the pixel and its neighbors in the x and y directions:

<p align="center">
    <img src="energy-formulas.png" alt="energy formula" />
</p>

For the left and right neighbors of a pixel, we need to compare the red, green, and blue values of the pixels. We do the same for the top and bottom neightbors. See the [function `compute_energies` for the rust implementation](https://github.com/trevorstenson/rust-seam-carving/blob/main/src/lib.rs#L38).

<p align="center">
    <img src="pixel-squares.png" alt="pixel diagram" />
</p>

After doing this for all pixels, the final step for an iteration is to find the lowest cumulative energy path from top to bottom using a little bit of backtracking, and then removing those pixels from the image. This is repeated for each iteration until the image is the desired size.

Below you can see some example images and the initially identified seams highlighted in red:

<div align="center" style="display: flex; flex-direction: row;">
    <img src="fjord_orig.jpeg"/>
    <img src="fjord_marked.png"/>
</div>
<div align="center" style="display: flex; flex-direction: column;">
    <img src="plane_orig.jpeg"/>
    <img src="plane_marked.png"/>
</div>

Here is the associated function for identifying the current lowest energy seam:

```rust
fn find_seam(energies: &Vec<Vec<EnergyData>>) -> Vec<usize> {
    let height = energies.len();
    let width = energies[0].len();
    let mut seam_energies = vec![vec![0; width]; height];
    let mut choices = vec![vec![0; width]; height];

    seam_energies[0] = energies[0].iter().map(|e| e.energy).collect();

    for y in 1..height {
        for x in 0..width {
            // support wrap around for left and right edges
            let left_x = if x == 0 { width - 1 } else { x - 1 };
            let right_x = if x == width - 1 { 0 } else { x + 1 };
            let neighbors = [left_x, x, right_x];
            let (chosen_idx, min_energy) = neighbors
                .iter()
                .map(|&x| seam_energies[y - 1][x])
                .enumerate()
                .min_by_key(|&(_, e)| e)
                .unwrap();
            seam_energies[y][x] = energies[y][x].energy + min_energy;
            choices[y][x] = neighbors[chosen_idx];
        }
    }

    let mut seam = Vec::with_capacity(height);
    let mut curr_x = seam_energies[height - 1]
        .iter()
        .enumerate()
        .min_by_key(|&(_, e)| e)
        .unwrap().0;
    seam.push(curr_x);
    for y in (1..height).rev() {
        curr_x = choices[y][curr_x];
        seam.push(curr_x);
    }
    seam.reverse();
    seam
}
```

## Fin

If you want to test out this implementation for yourself, check out the demo at the links below. You can carve your own images, as well as see what the initial seams would look like:

- [Demo link](https://wasmseamcarving--trevorstenson.repl.co/)
- [Source code](https://github.com/trevorstenson/rust-seam-carving)

For a first experience with WASM in Rust, [wasm-pack](https://github.com/rustwasm/wasm-pack) was definitely the way to go. The only problems I had were related to my environment detecting failing to detect changes in my built `pkg` directory for dependency reinstall, but no real issues with the tool itself. Getting used to the types of data that can be passed cleanly through the WASM boundary was a bit of a learning curve, but overall it was a very smooth experience.

As a weekend project during a period where I had seemingly taken a break from programming for the sake of it, deciding to revisit the novelty of one of my well-remembered college projects was a wonderful experience.