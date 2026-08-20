import {User} from '@dao/users.dao'
import {cn} from '~/ui/utils'
import {UserComponent} from './UserComponent'
import {ProjectSwitcher} from './ProjectSwitcher'
import {FileText, MessageCircle, AlertCircle, BellRing} from 'lucide-react'
import {APP_NAME} from '~/constants'
import {useEffect} from 'react'
import {Link, useParams} from '@remix-run/react'
import {useCustomNavigate} from '@hooks/useCustomNavigate'
import {ORG_ID, SMALL_PAGE_SIZE} from '@route/utils/constants'

export const AppHeader = ({user}: {user: User | undefined}) => {
  const {projectId} = useParams()
  const navigate = useCustomNavigate()
  
  // Always set CSS variable to 0 (no sidebar)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.style.setProperty('--sidebar-width', '0rem')
    }
  }, [])

  return (
    <>
      <header
        className={cn(
          'flex sticky top-0 z-50 justify-between items-center px-8',
          'border-b bg-slate-900 border-slate-800',
          'shadow-sm',
          'h-16',
        )}>
        {/* Left Section */}
        <div className="flex gap-4 items-center">
          {/* App Logo - Clickable to go to projects */}
          <button
            onClick={(e) => {
              e.preventDefault()
              navigate(`/projects?orgId=${ORG_ID}&page=1&pageSize=${SMALL_PAGE_SIZE}`, {})
            }}
            className="flex gap-3 items-center transition-opacity cursor-pointer hover:opacity-80">
            <img 
              src="/logo.svg" 
              alt={APP_NAME}
              className="w-auto h-10"
            />
            <span className="text-xl font-semibold tracking-tight text-white">
              {APP_NAME}
            </span>
          </button>

          {/* Project Switcher - Only show if in a project */}
          {projectId && (
            <>
              {/* Separator */}
              <div className="w-px h-6 bg-slate-700"></div>

              {/* Project Switcher */}
              <ProjectSwitcher />
            </>
          )}
        </div>

        {/* Right Section */}
        <div className="flex gap-4 items-center">
          <Link
            to="/my-retests"
            className="flex gap-2 items-center px-3 py-2 text-sm rounded-md transition-colors text-slate-300 hover:text-white hover:bg-slate-800">
            <BellRing className="w-4 h-4" />
            <span>My Retests</span>
          </Link>

          {/* Documentation */}
          <a
            href="https://checkmate.dreamhorizon.org"
            target="_blank"
            rel="noopener noreferrer"
            className="flex gap-2 items-center px-3 py-2 text-sm rounded-md transition-colors text-slate-300 hover:text-white hover:bg-slate-800">
            <FileText className="w-4 h-4" />
            <span>Docs</span>
          </a>

          {/* Ask Question */}
          <a
            href="https://discord.gg/wBQXeYAKNc"
            target="_blank"
            rel="noopener noreferrer"
            className="flex gap-2 items-center px-3 py-2 text-sm rounded-md transition-colors text-slate-300 hover:text-white hover:bg-slate-800">
            <MessageCircle className="w-4 h-4" />
            <span>Discord</span>
          </a>

          {/* Report Issue */}
          <a
            href="https://github.com/dream-horizon-org/checkmate/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="flex gap-2 items-center px-3 py-2 text-sm rounded-md transition-colors text-slate-300 hover:text-white hover:bg-slate-800">
            <AlertCircle className="w-4 h-4" />
            <span>Issues</span>
          </a>

          {/* Separator */}
          <div className="w-px h-6 bg-slate-700"></div>

          {/* User Component */}
          {user?.userId && UserComponent(user)}
        </div>
      </header>
    </>
  )
}
