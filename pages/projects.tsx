import ms from 'ms'
import siteConfig from "../siteConfig.json";
import games from "../data/games";
import projects from "../data/projects";

import Link from "next/link";

import Layout from "../components/layout";
import { statCounter } from "../lib/github";

export default function Projects({ totalStars, totalForks, mostRecentPushFormatted }: { totalStars: number, totalForks: number, mostRecentPushFormatted: string }) {
  return (
    <Layout
      title="Projects"
      description="A list of my open source projects."
    >
      <h1>Projects</h1>
      <main>
        <p>
          My side projects include programming languages, game solvers, developer tools, databases, and games. My public GitHub repositories been starred {totalStars} times, forked {totalForks} times, and my most recent <code>git push</code> was {mostRecentPushFormatted} ago (this section updates <a href="https://github.com/trevorstenson/trevo.rs/blob/7d9881e0dfea6b81eef173a7dc98186b20ce6eae/pages/projects.tsx#L90">every half an hour</a>).
        </p>
        <h2>Open Source</h2>
        <div className="project-list">
          {projects.map((project, i) => (
            <div className="project" key={i}>
              <a href={project.link} target="_blank">
                {project.name}
              </a>
              <p className="project-desc">{project.desc}</p>
              {project.to ? (
                <p className="project-post">
                  Read my <Link href={project.to} legacyBehavior>write-up</Link>.
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <h2>Game Jams</h2>
        <p>I miss doing game jams, it's been a while.</p>
        <div className="project-list">
          {games.map((game, i) => (
            <div className="project" key={i}>
              <a href={game.link} target="_blank">
                {game.name}
              </a>
              <p className="project-desc">{game.desc}</p>
            </div>
          ))}
        </div>
      </main>
      <style jsx>{`
        .project {
          flex: 50%;
          padding-right: 20px;
          padding-bottom: 28px;
        }
        .project-desc {
          margin-top: 4px;
          margin-bottom: 0px;
        }
        .project-post {
          margin-top: 0px;
          color: var(--light-text);
        }
        .project-list {
          display: flex;
          flex-wrap: wrap;
        }
        @media only screen and (max-width: ${siteConfig.LAYOUT_WIDTH}px) {
          .project-list {
            display: block;
          }
          .project {
            padding-right: 0px;
          }
        }
      `}</style>
    </Layout>
  );
}

export async function getStaticProps() {
  const { totalStars, totalForks, mostRecentPushFormatted } = await statCounter(siteConfig.AUTHOR_GITHUB)
  return {
    props: {
      totalStars,
      totalForks,
      mostRecentPushFormatted,
    },
    revalidate: ms('30min') / 1000, // TIL this is seconds
  }
}
