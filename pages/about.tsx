import siteConfig from "../siteConfig.json";
import mePresenting from "../public/assets/presenting-high-res.jpg";

import SpacedImage from "../components/image";
import Layout from "../components/layout";

export default function About() {
  return (
    <Layout title="About" description="About me.">
      <h1>About</h1>
      <main>
        Hey, I'm Trevor Stenson.
        <p>I'm interested in:</p>
        <ul>
          <li>Full stack development</li>
          <li>Web performance</li>
          <li>Natural language processing</li>
        </ul>
        <p>
          On this blog I write about things that interest me and projects I am working on. In my spare time
          I enjoy juggling, road cycling, skiing, and hiking. I read a lot of
          science fiction. My favorite books include{" "}
          <a href="https://www.goodreads.com/en/book/show/17863">Accelerando</a>{" "}
          and{" "}
          <a href="https://www.goodreads.com/book/show/20518872-the-three-body-problem">
            The Three Body Problem
          </a>
          .
        </p>
        <h2>Work</h2>
        <p>
          I am currently a full stack engineer at <a href="https://www.reprise.com/">Reprise</a> building a
          web platform for infrastructure-less no-code product demos.
        </p>
        <p>
          In 2020, I worked at <a href="https://www.smartleaf.com/">Smartleaf</a> building an enterprise ruby on
          rails platform for automated tax-loss harvesting. Before that I
          contributed to multiple full stack client projects at{" "}
          <a href="https://rightpoint.com/">Rightpoint</a>.
        </p>
        <h2>Contact</h2>
        <p>
          Github: <a>https://github.com/trevorstenson</a>
          <br />
          Email: <a href="mailto">mail@trevo.rs</a>
        </p>
        <p>
          I love talking to people who share similar interests, so feel free to
          reach out!
        </p>
        {/* <SpacedImage
          src={mePresenting}
          placeholder="blur"
          alt="Presenting: When Does Development Spark Joy? Sentimental analysis of commit messages."
          quality={100}
          originalWidth={mePresenting.width}
          originalHeight={mePresenting.height}
          priority={true}
        /> */}
      </main>
    </Layout>
  );
}
