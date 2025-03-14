---
title: Load testing
layout: ../../layouts/post.astro
description: Browser locally uses AI to remove image backgrounds
slug: load-testing
date: 2023-01-02
published: true
featuredImage: ../../images/blog/load-testing/gauges.jpg
language: en

dateFormatted: Jan 2nd, 2023
---

![gauges](/assets/images/blog/load-testing/gauges.jpg "gauges")

Applications designed to handle a large number of users can generate high bills for server usage. Sometimes we want to introduce an optimization to improve performance, but how can we check if it actually works?

## Benefits of performance testing

I've encountered the topic of load testing at work. Generally, the simplest way to do it is to keep pressing F5 on the opened page that we want to test and see if the server can handle it - good for us :p. However, sometimes a quantitative approach is useful. It is good if the performance testing tool shows a report with specific information - how much time the request needed on a given endpoint, what variance we had, certain percentiles (e.g. 50, 75, 90, 99), or any other stats provided by mathematics.

## How will I present the topic?

To introduce this topic, I will try to discuss its essential elements and show how performance testing can be implemented using Python and Azure. At the same time, I will try to make this example universal enough to be treated as scaffolding for real-world applications. For this purpose, a repo on GitHub will be created with all the necessary code, and a series of streams on YouTube where I will go through the whole process step by step. Links to YT and GH can be found on the main page.

## Inspirations

- [Python script useful for stress testing systems](https://gist.github.com/mda590/7a9a6b21b74ae10aa350b1703e2724a0)
- [Performing load tests with Python + Locust.io | by Thiago Ferreira | Medium](https://medium.com/@tferreiraw/performing-load-tests-with-python-locust-io-62de7d91eebd)
- [Performance Testing vs. Load Testing vs. Stress Testing | Blazemeter by Perforce](https://www.blazemeter.com/blog/performance-testing-vs-load-testing-vs-stress-testing)
