import siteConfig from "../siteConfig.json";
// import meAvatar from "../public/assets/avatar-v1.jpg";
import meAvatar from "../public/assets/green_face.jpg";

import Image from "next/image";
import Link from "next/link";

import Layout from "../components/layout";
import PostList from "../components/postList";
import Newsletter from "../components/newsletter";

import { getSortedPostsData, getPostData } from "../lib/posts";
import { generateRssFeed } from "../lib/rss";

export async function getStaticProps() {
  await generateRssFeed();

  const allPostsData = getSortedPostsData();
  const words = allPostsData.reduce(
    (count, current) =>
      count + getPostData(current.id).content.split(" ").length,
    0
  );
  return {
    props: {
      allPostsData,
      description: siteConfig.SITE_DESC,
      words,
    },
  };
}

export default function Home({ allPostsData, description, words }) {
  function numberWithCommas(x: number) {
    // https://stackoverflow.com/a/2901298
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  return (
    <Layout title="Blog" description={description}>
      <main>
        <div className="avatar">
          <div
            style={{
              borderRadius: "10px",
              overflow: "hidden",
              height: "160px",
              width: "160px",
            }}
          >
            <Image
              src={meAvatar}
              objectFit="cover"
              layout="responsive"
              alt="Trevor Stenson"
              quality={100}
              placeholder="blur"
              priority={true}
            />
          </div>

          <div>
            <p className="avatar-text">
              Hey, I'm Trevor Stenson, and welcome to my personal site! I am a
              full stack software engineer at Reprise interested in all things
              web development.
            </p>
            <p className="avatar-text">
              Feel free to check out my <Link href="/blog">blog</Link> or learn
              more <Link href="/about">about me</Link>.
            </p>
          </div>
        </div>

        <div className="posts">
          <section className="posts-section">
            <h2>
              Recent (
              <Link
                href="/blog"
                legacyBehavior
              >{`${allPostsData.length} posts`}</Link>
              )
            </h2>
            <PostList posts={allPostsData.slice(0, 3)} hideTags={true} />
          </section>
          {/* <section className="posts-section">
            <h2>Popular</h2>
            <PostList
              posts={allPostsData.filter((post) =>
                siteConfig.PINNED_POSTS.includes(post.id)
              )}
              hideTags={true}
            />
          </section> */}
        </div>
      </main>
      {/* <footer>
        <Newsletter />
      </footer> */}
      <style jsx>{`
        .avatar {
          display: flex;
          align-items: center;
          padding-top: 36px;
          padding-bottom: 6px;
        }
        .avatar-text {
          margin-left: 28px;
          max-width: 480px;
        }
        .posts {
          display: flex;
          justify-content: center;
        }
        // .posts-section {
        //   flex: 1;
        //   padding-right: 20px;
        // }

        @media only screen and (max-width: ${siteConfig.LAYOUT_WIDTH}px) {
          .avatar {
            display: block;
            padding-top: 38px;
          }
          .avatar-text {
            margin-left: initial;
            margin-bottom: 0px;
          }
          .posts {
            display: block;
          }
          .posts-section {
            padding-right: 0px;
          }
        }
      `}</style>
    </Layout>
  );
}
