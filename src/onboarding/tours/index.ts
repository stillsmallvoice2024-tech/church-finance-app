import type { TourDefinition, TourId, PageId } from '../../types/onboarding'
import { dashboardTour } from './dashboardTour'
import { banksTour } from './banksTour'
import { inflowsTour } from './inflowsTour'
import { outflowsTour } from './outflowsTour'
import { importTour } from './importTour'
import { categoriesTour } from './categoriesTour'
import { setupTour } from './setupTour'
import { reportsTour } from './reportsTour'
import { settingsTour } from './settingsTour'
import { usersTour } from './usersTour'

export const ALL_TOURS: TourDefinition[] = [
  dashboardTour,
  banksTour,
  inflowsTour,
  outflowsTour,
  importTour,
  categoriesTour,
  setupTour,
  reportsTour,
  settingsTour,
  usersTour,
]

const TOUR_BY_ID = new Map<TourId, TourDefinition>(
  ALL_TOURS.map((t) => [t.id, t]),
)

const TOUR_BY_PAGE = new Map<PageId, TourDefinition>(
  ALL_TOURS.map((t) => [t.pageId, t]),
)

export function getTourById(id: TourId): TourDefinition | undefined {
  return TOUR_BY_ID.get(id)
}

export function getTourByPage(pageId: PageId): TourDefinition | undefined {
  return TOUR_BY_PAGE.get(pageId)
}
