import Navbar from '../components/landing/Navbar'
import Hero from '../components/landing/Hero'
import Features from '../components/landing/Features'
import HowItWorks from '../components/landing/HowItWorks'
import CaseStudies from '../components/landing/CaseStudies'
import MarketInsights from '../components/landing/MarketInsights'
import Testimonials from '../components/landing/Testimonials'
import Pricing from '../components/landing/Pricing'
import Footer from '../components/landing/Footer'

export default function Landing() {
  return (
    <>
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <CaseStudies />
      <MarketInsights />
      <Testimonials />
      <Pricing />
      <Footer />
    </>
  )
}
